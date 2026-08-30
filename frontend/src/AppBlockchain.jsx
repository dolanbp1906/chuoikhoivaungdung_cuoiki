import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import "./App.css";

import AttendanceManagerArtifact from "./artifacts/AttendanceManager.json";
import {
  TEACHER_ROLE,
  createContractInstances,
  deployAll,
  parseCertificateIssuedTokenId,
} from "./lib/contracts";
import {
  clearDeployment,
  loadDeployment,
  loadStudentCertificateTokenId,
  saveDeployment,
  saveStudentCertificateTokenId,
} from "./lib/storage";

function toUnixSeconds(dateTimeLocal) {
  const ms = new Date(dateTimeLocal).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function formatBigInt(value) {
  try {
    return value.toString();
  } catch {
    return String(value ?? "");
  }
}

function formatToken(value) {
  try {
    // ERC-20 dùng 18 decimals: 1 token = 10^18 đơn vị nhỏ
    const formatted = ethers.formatEther(value);
    const n = Number(formatted);
    if (!Number.isFinite(n)) return formatted;
    if (Number.isInteger(n)) return String(n);
    return n.toLocaleString("vi-VN", { maximumFractionDigits: 4 });
  } catch {
    return formatBigInt(value);
  }
}

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function classLabel(classes, classId) {
  const found = classes.find((c) => String(c.id) === String(classId));
  return found ? `#${found.id} — ${found.name}` : `ClassId ${classId}`;
}

const REVERT_MESSAGES = [
  ["Already enrolled", "Học viên này đã được đăng ký vào lớp rồi. Hãy điểm danh hoặc enroll địa chỉ khác."],
  ["Student not enrolled", "Học viên chưa được đăng ký vào lớp. Hãy Enroll trước."],
  ["Class not active", "Lớp không còn hoạt động."],
  ["Outside class period", "Ngoài thời gian học của lớp (startDate–endDate). Hãy kiểm tra ngày bắt đầu/kết thúc."],
  ["Already completed", "Học viên đã hoàn thành bài tập này rồi."],
  ["Certificate already issued", "Chứng nhận NFT đã được cấp cho học viên này trong lớp này."],
  ["No attendance", "Chưa có điểm danh. Cần điểm danh ít nhất 1 buổi trước khi cấp chứng nhận."],
  ["Assignments not completed", "Học viên chưa hoàn thành hết bài tập của lớp."],
  ["Invalid dates", "Ngày kết thúc phải sau ngày bắt đầu."],
  ["AccessControlUnauthorizedAccount", "Ví hiện tại không có quyền Teacher. Hãy dùng đúng ví đã deploy contract."],
  ["user rejected", "Bạn đã hủy giao dịch trên MetaMask."],
  ["ACTION_REJECTED", "Bạn đã hủy giao dịch trên MetaMask."],
  ["insufficient funds", "Ví không đủ ETH để trả phí gas."],
  ["network changed", "Mạng MetaMask đã đổi. Hãy Connect lại."],
];

function friendlyError(err) {
  const raw = [
    err?.shortMessage,
    err?.reason,
    err?.info?.error?.message,
    err?.data?.message,
    err?.message,
    String(err ?? ""),
  ]
    .filter(Boolean)
    .join(" | ");

  for (const [key, msg] of REVERT_MESSAGES) {
    if (raw.toLowerCase().includes(key.toLowerCase())) return msg;
  }

  const m = raw.match(/reason="([^"]+)"/i) || raw.match(/reverted with reason string '([^']+)'/i);
  if (m?.[1]) {
    for (const [key, msg] of REVERT_MESSAGES) {
      if (m[1].toLowerCase().includes(key.toLowerCase())) return msg;
    }
    return `Giao dịch bị từ chối: ${m[1]}`;
  }

  if (raw.length > 160) {
    return "Giao dịch thất bại. Kiểm tra lại dữ liệu nhập và quyền Teacher, rồi thử lại.";
  }
  return raw || "Đã xảy ra lỗi không xác định.";
}

export default function AppBlockchain() {
  const attendanceInterface = useMemo(
    () => new ethers.Interface(AttendanceManagerArtifact.abi),
    []
  );

  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [deployment, setDeployment] = useState(() => loadDeployment());
  const [contracts, setContracts] = useState(null);
  const [isTeacher, setIsTeacher] = useState(false);
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [tab, setTab] = useState("teacher"); // teacher | student

  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);

  const canUseContracts =
    Boolean(contracts?.attendanceManager) &&
    Boolean(contracts?.rewardToken) &&
    Boolean(contracts?.certificateNFT);

  const chainHint = useMemo(() => {
    if (chainId == null) return "";
    if (chainId === 31337) return "Bạn đang ở Hardhat Local (31337).";
    if (chainId === 11155111) return "Bạn đang ở Sepolia (11155111).";
    if (chainId === 1) return "Đang ở Ethereum Mainnet (1) — hãy chuyển sang Sepolia.";
    return `ChainId hiện tại: ${chainId}`;
  }, [chainId]);

  function setOk(message) {
    setStatus({ type: "ok", message });
  }
  function setErr(message) {
    setStatus({ type: "err", message });
  }
  function handleErr(err) {
    setErr(friendlyError(err));
  }

  // Teacher inputs
  const [className, setClassName] = useState("");
  const [classStart, setClassStart] = useState("");
  const [classEnd, setClassEnd] = useState("");
  const [enrollClassId, setEnrollClassId] = useState("0");
  const [enrollStudentAddr, setEnrollStudentAddr] = useState("");
  const [enrollStudentName, setEnrollStudentName] = useState("");
  const [attendanceClassId, setAttendanceClassId] = useState("0");
  const [attendanceStudents, setAttendanceStudents] = useState("");
  const [assignmentClassId, setAssignmentClassId] = useState("0");
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentDeadline, setAssignmentDeadline] = useState("");
  const [completionAssignmentId, setCompletionAssignmentId] = useState("0");
  const [completionStudentAddr, setCompletionStudentAddr] = useState("");
  const [certificateClassId, setCertificateClassId] = useState("0");
  const [certificateStudentAddr, setCertificateStudentAddr] = useState("");

  // Student inputs / outputs
  const [studentClassId, setStudentClassId] = useState("0");
  const [studentHistory, setStudentHistory] = useState([]);
  const [studentTokenBalance, setStudentTokenBalance] = useState("0");
  const [studentAttendanceCount, setStudentAttendanceCount] = useState("0");
  const [studentCertificateBalance, setStudentCertificateBalance] = useState("0");
  const [cachedCertificateTokenId, setCachedCertificateTokenId] = useState(null);
  const [studentCompletedAssignmentIds, setStudentCompletedAssignmentIds] = useState([]);

  async function refreshClasses(attendanceManager) {
    const count = await attendanceManager.classCount();
    const countNum = Number(count);
    const list = [];

    for (let i = 0; i < countNum; i++) {
      const cls = await attendanceManager.classes(i);
      list.push({
        id: i,
        name: cls.name,
        teacher: cls.teacher,
        startDate: Number(cls.startDate),
        endDate: Number(cls.endDate),
        active: Boolean(cls.active),
      });
    }

    setClasses(list);
    return list;
  }

  async function refreshAssignments(attendanceManager, classId) {
    const ids = await attendanceManager.getClassAssignments(classId);
    const list = [];
    for (const id of ids) {
      const a = await attendanceManager.assignments(id);
      list.push({
        id: a.id.toString(),
        classId: a.classId.toString(),
        title: a.title,
        deadline: a.deadline.toString(),
      });
    }
    setAssignments(list);
    return list;
  }


  async function refreshTeacherRole(attendanceManager, addr) {
    if (!attendanceManager || !addr) {
      setIsTeacher(false);
      return false;
    }
    try {
      const ok = await attendanceManager.hasRole(TEACHER_ROLE, addr);
      setIsTeacher(Boolean(ok));
      return Boolean(ok);
    } catch {
      setIsTeacher(false);
      return false;
    }
  }

  async function connectWallet() {
    if (!window.ethereum) return setErr("Chưa thấy MetaMask (window.ethereum)");

    try {
      setStatus({ type: "idle", message: "Đang kết nối ví..." });
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      const net = await provider.getNetwork();

      setAccount(addr);
      setChainId(Number(net.chainId));

      const dep = loadDeployment();
      if (dep && dep.chainId === Number(net.chainId)) {
        const instances = createContractInstances(signer, dep.addresses);
        setContracts(instances);
        await refreshClasses(instances.attendanceManager);
        const teacher = await refreshTeacherRole(instances.attendanceManager, addr);
        setTab(teacher ? "teacher" : "student");
      } else {
        setContracts(null);
        setClasses([]);
        setAssignments([]);
        setIsTeacher(false);
      }

      setOk(`Kết nối thành công: ${addr}`);
    } catch (e) {
      handleErr(e);
    }
  }

  async function switchToSepolia() {
    if (!window.ethereum) return setErr("Chưa thấy MetaMask");
    const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

    try {
      setStatus({ type: "idle", message: "Đang chuyển MetaMask sang Sepolia..." });
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
      await connectWallet();
      setOk("Đã chuyển sang Sepolia (11155111).");
    } catch (e) {
      // 4902 = chain chưa có trong MetaMask → thêm mạng
      if (e?.code === 4902 || e?.error?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: SEPOLIA_CHAIN_ID_HEX,
                chainName: "Sepolia",
                nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://rpc.sepolia.org"],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ],
          });
          await connectWallet();
          setOk("Đã thêm và chuyển sang Sepolia (11155111).");
        } catch (addErr) {
          handleErr(addErr);
        }
      } else {
        handleErr(e);
      }
    }
  }

  async function doDeploy() {
    if (!window.ethereum) return setErr("Chưa có MetaMask");

    try {
      setStatus({ type: "idle", message: "Đang deploy hợp đồng..." });
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const depAddresses = await deployAll(signer);
      const net = await provider.getNetwork();

      const nextDeployment = {
        chainId: Number(net.chainId),
        addresses: depAddresses,
        deployedAt: Date.now(),
      };

      saveDeployment(nextDeployment);
      setDeployment(nextDeployment);

      const instances = createContractInstances(signer, depAddresses);
      setContracts(instances);

      await refreshClasses(instances.attendanceManager);
      await refreshAssignments(instances.attendanceManager, Number(assignmentClassId));
      await refreshTeacherRole(instances.attendanceManager, await signer.getAddress());
      setTab("teacher");
      setOk("Deploy xong.");
    } catch (e) {
      handleErr(e);
    }
  }

  async function handleCreateClass() {
    if (!canUseContracts) return;
    const startTs = toUnixSeconds(classStart);
    const endTs = toUnixSeconds(classEnd);

    if (!className.trim()) return setErr("Nhập tên lớp");
    if (!startTs || !endTs) return setErr("Chọn thời gian bắt đầu/kết thúc");

    try {
      setStatus({ type: "idle", message: "Tạo lớp..." });
      const tx = await contracts.attendanceManager.createClass(className, startTs, endTs);
      await tx.wait();

      const list = await refreshClasses(contracts.attendanceManager);
      if (list.length) {
        const last = list[list.length - 1];
        setEnrollClassId(String(last.id));
        setAttendanceClassId(String(last.id));
        setAssignmentClassId(String(last.id));
        setCertificateClassId(String(last.id));
        setStudentClassId(String(last.id));
      }
      setOk("Tạo lớp thành công");
    } catch (e) {
      handleErr(e);
    }
  }

  async function handleEnroll() {
    if (!canUseContracts) return;
    if (!ethers.isAddress(enrollStudentAddr)) return setErr("Địa chỉ học viên không hợp lệ");

    try {
      setStatus({ type: "idle", message: "Enroll học viên..." });
      const tx = await contracts.attendanceManager.enrollStudent(
        Number(enrollClassId),
        enrollStudentAddr,
        enrollStudentName || "Student"
      );
      await tx.wait();
      await refreshClasses(contracts.attendanceManager);
      setOk("Enroll xong");
    } catch (e) {
      handleErr(e);
    }
  }

  async function handleMarkAttendance() {
    if (!canUseContracts) return;
    const raw = attendanceStudents.split(/[\\n,]/g).map((s) => s.trim()).filter(Boolean);
    const cleaned = raw.filter((a) => ethers.isAddress(a));
    if (cleaned.length === 0) return setErr("Chưa có địa chỉ hợp lệ để điểm danh");

    try {
      setStatus({ type: "idle", message: "Đang điểm danh..." });
      const tx = await contracts.attendanceManager.markAttendance(Number(attendanceClassId), cleaned);
      await tx.wait();
      setOk("Điểm danh xong");
    } catch (e) {
      handleErr(e);
    }
  }

  async function handleCreateAssignment() {
    if (!canUseContracts) return;
    const deadlineTs = toUnixSeconds(assignmentDeadline);
    if (!assignmentTitle.trim()) return setErr("Nhập tiêu đề bài tập");
    if (!deadlineTs) return setErr("Chọn deadline");

    try {
      setStatus({ type: "idle", message: "Tạo bài tập..." });
      const tx = await contracts.attendanceManager.createAssignment(
        Number(assignmentClassId),
        assignmentTitle,
        deadlineTs
      );
      await tx.wait();
      await refreshAssignments(contracts.attendanceManager, Number(assignmentClassId));
      setOk("Tạo bài tập thành công");
    } catch (e) {
      handleErr(e);
    }
  }

  async function handleRecordCompletion() {
    if (!canUseContracts) return;
    if (!ethers.isAddress(completionStudentAddr)) return setErr("Địa chỉ học viên không hợp lệ");

    try {
      setStatus({ type: "idle", message: "Ghi nhận hoàn thành..." });
      const tx = await contracts.attendanceManager.recordAssignmentCompletion(
        Number(completionAssignmentId),
        completionStudentAddr
      );
      await tx.wait();
      setOk("Hoàn thành xong");
    } catch (e) {
      handleErr(e);
    }
  }

  async function handleIssueCertificate() {
    if (!canUseContracts) return;
    if (!ethers.isAddress(certificateStudentAddr)) return setErr("Địa chỉ học viên không hợp lệ");

    try {
      setStatus({ type: "idle", message: "Đang phát hành chứng nhận..." });
      const tx = await contracts.attendanceManager.issueCertificate(
        Number(certificateClassId),
        certificateStudentAddr
      );
      const receipt = await tx.wait();

      const tokenId = parseCertificateIssuedTokenId(attendanceInterface, receipt);
      if (tokenId != null) {
        saveStudentCertificateTokenId(
          Number(chainId ?? 0),
          Number(certificateClassId),
          certificateStudentAddr,
          tokenId
        );
      }

      setOk(
        tokenId != null
          ? `Cấp chứng nhận xong (tokenId=${tokenId})`
          : "Cấp chứng nhận xong"
      );
    } catch (e) {
      handleErr(e);
    }
  }

  async function refreshStudentViews() {
    if (!canUseContracts) return;
    if (!ethers.isAddress(account)) return;

    const cid = Number(studentClassId);
    try {
      setStatus({ type: "idle", message: "Đang load dữ liệu học tập..." });

      // Reset theo lớp trước khi load — tránh giữ số liệu lớp cũ
      setStudentAttendanceCount("0");
      setStudentHistory([]);
      setStudentCompletedAssignmentIds([]);
      setCachedCertificateTokenId(null);
      setStudentCertificateBalance("0");

      const [bal, attendCount, certForClass, enrolledHere, history, completedAssignmentIds] =
        await Promise.all([
          contracts.rewardToken.balanceOf(account),
          contracts.attendanceManager.getStudentAttendanceCount(cid, account),
          contracts.attendanceManager.certificateIssued(cid, account),
          contracts.attendanceManager.enrolled(cid, account),
          contracts.attendanceManager.getAttendanceHistory(cid, account),
          contracts.attendanceManager.getCompletedAssignments(cid, account),
        ]);

      setStudentTokenBalance(formatToken(bal));
      setStudentAttendanceCount(formatBigInt(attendCount));
      // NFT theo lớp (không dùng balanceOf cả ví)
      setStudentCertificateBalance(certForClass ? "1" : "0");

      const last = history.slice(-10).map((r) => ({
        timestamp: Number(r.timestamp),
        present: Boolean(r.present),
      }));
      setStudentHistory(last);

      setStudentCompletedAssignmentIds(
        completedAssignmentIds.map((id) => id.toString())
      );

      const cachedId = loadStudentCertificateTokenId(Number(chainId ?? 0), cid, account);
      setCachedCertificateTokenId(cachedId);

      if (!enrolledHere) {
        setOk(`Load xong — ví chưa enroll lớp #${cid}`);
      } else {
        setOk(`Load xong — lớp #${cid}`);
      }
    } catch (e) {
      handleErr(e);
    }
  }

  useEffect(() => {
    if (!canUseContracts) return;
    refreshClasses(contracts.attendanceManager).catch(() => {});
  }, [canUseContracts]);

  useEffect(() => {
    if (!canUseContracts) return;
    refreshAssignments(contracts.attendanceManager, Number(assignmentClassId)).catch(() => {});
  }, [canUseContracts, assignmentClassId]);

  useEffect(() => {
    if (!canUseContracts) return;
    if (isTeacher && tab !== "teacher") setTab("teacher");
    if (!isTeacher && tab !== "student") setTab("student");
  }, [canUseContracts, isTeacher]);

  useEffect(() => {
    if (!canUseContracts || tab !== "student") return;
    if (!ethers.isAddress(account)) return;
    refreshStudentViews().catch(() => {});
  }, [canUseContracts, tab, studentClassId, account]);

  useEffect(() => {
    if (!window.ethereum?.on) return undefined;

    const onChainChanged = () => {
      // MetaMask khuyến nghị reload khi đổi chain
      window.location.reload();
    };
    const onAccountsChanged = () => {
      window.location.reload();
    };

    window.ethereum.on("chainChanged", onChainChanged);
    window.ethereum.on("accountsChanged", onAccountsChanged);
    return () => {
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, []);

  const selectedClassHint = classLabel(classes, tab === "student" ? studentClassId : enrollClassId);

  return (
    <div className="appRoot">
      <div className="topBar">
        <div>
          <div className="appTitle">Hệ thống điểm danh trên Blockchain</div>
          <div className="small">{chainHint || "Chưa xác định mạng — hãy Connect MetaMask"}</div>
        </div>

        <div className="row" style={{ margin: 0 }}>
          {account ? (
            <div className="walletChip">
              <span className="small">Ví đang dùng</span>
              <span className="mono">{shortAddr(account)}</span>
            </div>
          ) : (
            <div className="small">Chưa kết nối ví</div>
          )}
          {chainId !== 11155111 ? (
            <button className="btn" onClick={switchToSepolia}>
              Chuyển Sepolia
            </button>
          ) : null}
          <button className="btn" onClick={connectWallet}>
            {account ? "Kết nối lại" : "Connect MetaMask"}
          </button>
        </div>
      </div>

      <div className="tabs">
        {isTeacher || !canUseContracts ? (
          <button
            className={`tabBtn ${tab === "teacher" ? "tabBtnActive" : ""}`}
            onClick={() => setTab("teacher")}
          >
            Giáo viên (Teacher)
          </button>
        ) : null}
        {!isTeacher || !canUseContracts ? (
          <button
            className={`tabBtn ${tab === "student" ? "tabBtnActive" : ""}`}
            onClick={() => setTab("student")}
          >
            Học viên (Student)
          </button>
        ) : null}
      </div>
      {canUseContracts ? (
        <div className="roleHint">
          {isTeacher
            ? "Vai trò ví hiện tại: Giáo viên — chỉ thao tác quản lý lớp"
            : "Vai trò ví hiện tại: Học viên — chỉ xem thông tin học tập"}
        </div>
      ) : null}

      {status.message ? (
        <div className={status.type === "ok" ? "statusOk" : status.type === "err" ? "statusErr" : "statusIdle"}>
          {status.message}
        </div>
      ) : null}

      {!canUseContracts ? (
        <div className="card">
          <h2>Bước 0 — Kết nối hợp đồng</h2>
          <p className="hint">
            <b>Sepolia:</b> đã deploy sẵn thì dán địa chỉ vào localStorage (hoặc bấm Deploy để tạo bộ mới, tốn gas).
            <br />
            <b>Local:</b> chạy <span className="mono">npx hardhat node</span>, MetaMask chainId <b>31337</b>, rồi Deploy.
          </p>
          <div className="row">
            <button className="btn" onClick={doDeploy}>Deploy hợp đồng</button>
            <button
              className="btn btnGhost"
              disabled={!deployment}
              onClick={() => {
                clearDeployment();
                setDeployment(null);
                setContracts(null);
                setClasses([]);
                setAssignments([]);
                setIsTeacher(false);
              }}
            >
              Xóa địa chỉ đã lưu
            </button>
          </div>
        </div>
      ) : tab === "teacher" ? (
        !isTeacher ? (
          <div className="card">
            <h2>Không có quyền Giáo viên</h2>
            <p className="hint">
              Ví <span className="mono">{shortAddr(account)}</span> chưa được cấp <b>TEACHER_ROLE</b>.
              Hãy chuyển MetaMask sang ví đã deploy hợp đồng (hoặc ví được Admin cấp quyền), rồi bấm Kết nối lại.
            </p>
            <button className="btn" onClick={() => setTab("student")}>Sang tab Học viên</button>
          </div>
        ) : (
        <div className="grid2">
          <div className="card">
            <h2>1. Tạo lớp học</h2>
            <p className="hint">Chọn khoảng thời gian bao gồm thời điểm hiện tại để điểm danh được.</p>
            <div className="row">
              <div className="label">Tên lớp</div>
              <input className="input" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Ví dụ: Lớp Blockchain Demo" />
            </div>
            <div className="row">
              <div className="label">Bắt đầu</div>
              <input className="input" type="datetime-local" value={classStart} onChange={(e) => setClassStart(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Kết thúc</div>
              <input className="input" type="datetime-local" value={classEnd} onChange={(e) => setClassEnd(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn" onClick={handleCreateClass}>Tạo lớp</button>
            </div>
          </div>

          <div className="card">
            <h2>Danh sách lớp</h2>
            <p className="hint">Bấm <b>Chọn</b> để tự điền ClassId vào các form bên dưới.</p>
            {classes.length ? (
              classes.map((c) => (
                <div key={c.id} className="listItem">
                  <div>
                    <div className="listTitle">#{c.id} — {c.name}</div>
                    <div className="small">Giáo viên: <span className="mono">{shortAddr(c.teacher)}</span></div>
                    <div className="small">
                      {new Date(c.startDate * 1000).toLocaleString()} → {new Date(c.endDate * 1000).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="btn"
                    onClick={() => {
                      setEnrollClassId(String(c.id));
                      setAttendanceClassId(String(c.id));
                      setAssignmentClassId(String(c.id));
                      setCertificateClassId(String(c.id));
                      setStudentClassId(String(c.id));
                    }}
                  >
                    Chọn
                  </button>
                </div>
              ))
            ) : (
              <div className="small">Chưa có lớp. Hãy tạo lớp trước.</div>
            )}
          </div>

          <div className="card">
            <h2>2. Đăng ký học viên (Enroll)</h2>
            <p className="hint">Mỗi địa chỉ ví chỉ đăng ký <b>một lần</b> cho mỗi lớp. Đang chọn: {classLabel(classes, enrollClassId)}</p>
            <div className="row">
              <div className="label">Mã lớp (ClassId)</div>
              <input className="input" value={enrollClassId} onChange={(e) => setEnrollClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Địa chỉ ví học viên</div>
              <input className="input" value={enrollStudentAddr} onChange={(e) => setEnrollStudentAddr(e.target.value)} placeholder="0x..." />
            </div>
            <div className="row">
              <div className="label">Họ tên học viên</div>
              <input className="input" value={enrollStudentName} onChange={(e) => setEnrollStudentName(e.target.value)} placeholder="Nguyễn Văn A" />
            </div>
            <div className="row">
              <button className="btn" onClick={handleEnroll}>Đăng ký học viên</button>
            </div>
          </div>

          <div className="card">
            <h2>3. Điểm danh</h2>
            <p className="hint">Thưởng <b>+1 token</b> cho mỗi học viên trong danh sách. Có thể nhập nhiều địa chỉ (mỗi dòng hoặc cách bằng dấu phẩy).</p>
            <div className="row">
              <div className="label">Mã lớp (ClassId)</div>
              <input className="input" value={attendanceClassId} onChange={(e) => setAttendanceClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Danh sách địa chỉ</div>
              <textarea className="textarea" value={attendanceStudents} onChange={(e) => setAttendanceStudents(e.target.value)} placeholder={"0xabc...\n0xdef..."} />
            </div>
            <div className="row">
              <button className="btn" onClick={handleMarkAttendance}>Điểm danh (+1 token)</button>
            </div>
          </div>

          <div className="card">
            <h2>4. Tạo bài tập</h2>
            <p className="hint">Sau khi tạo, bấm <b>Chọn</b> trên bài tập để điền AssignmentId ở bước 5.</p>
            <div className="row">
              <div className="label">Mã lớp (ClassId)</div>
              <input className="input" value={assignmentClassId} onChange={(e) => setAssignmentClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Tiêu đề bài tập</div>
              <input className="input" value={assignmentTitle} onChange={(e) => setAssignmentTitle(e.target.value)} placeholder="Bài tập 1" />
            </div>
            <div className="row">
              <div className="label">Hạn nộp</div>
              <input className="input" type="datetime-local" value={assignmentDeadline} onChange={(e) => setAssignmentDeadline(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn" onClick={handleCreateAssignment}>Tạo bài tập</button>
            </div>

            <div className="sectionDivider" />
            <div className="listTitle">Bài tập trong lớp</div>
            {assignments.length ? (
              assignments.map((a) => (
                <div key={a.id} className="listItem">
                  <div>
                    <div className="listTitle">#{a.id} — {a.title}</div>
                    <div className="small">Hạn: {new Date(Number(a.deadline) * 1000).toLocaleString()}</div>
                  </div>
                  <button className="btn" onClick={() => setCompletionAssignmentId(a.id)}>Chọn</button>
                </div>
              ))
            ) : (
              <div className="small">Chưa có bài tập.</div>
            )}
          </div>

          <div className="card">
            <h2>5. Ghi nhận hoàn thành bài tập</h2>
            <p className="hint">Thưởng <b>+5 token</b>. Học viên phải đã enroll.</p>
            <div className="row">
              <div className="label">Mã bài tập (AssignmentId)</div>
              <input className="input" value={completionAssignmentId} onChange={(e) => setCompletionAssignmentId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Địa chỉ ví học viên</div>
              <input className="input" value={completionStudentAddr} onChange={(e) => setCompletionStudentAddr(e.target.value)} placeholder="0x..." />
            </div>
            <div className="row">
              <button className="btn" onClick={handleRecordCompletion}>Ghi nhận hoàn thành (+5 token)</button>
            </div>

            <div className="sectionDivider" />
            <h2>6. Cấp chứng nhận NFT</h2>
            <p className="hint">Cần đã điểm danh (≥1) và hoàn thành mọi bài tập của lớp (nếu có).</p>
            <div className="row">
              <div className="label">Mã lớp (ClassId)</div>
              <input className="input" value={certificateClassId} onChange={(e) => setCertificateClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Địa chỉ ví học viên</div>
              <input className="input" value={certificateStudentAddr} onChange={(e) => setCertificateStudentAddr(e.target.value)} placeholder="0x..." />
            </div>
            <div className="row">
              <button className="btn" onClick={handleIssueCertificate}>Cấp chứng nhận (NFT)</button>
            </div>
          </div>
        </div>
        )
      ) : (
        <div className="grid2">
          <div className="card">
            <h2>Thông tin học tập của bạn</h2>
            <p className="hint">
              Lớp đang xem: <b>{selectedClassHint}</b>
            </p>
            <div className="row">
              <div className="label">Chọn lớp</div>
              <select
                className="select"
                value={studentClassId}
                onChange={(e) => {
                  setStudentClassId(e.target.value);
                  // reset ngay khi đổi lớp
                  setStudentAttendanceCount("0");
                  setStudentHistory([]);
                  setStudentCompletedAssignmentIds([]);
                  setCachedCertificateTokenId(null);
                  setStudentCertificateBalance("0");
                }}
              >
                {classes.length ? (
                  classes.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      #{c.id} — {c.name}
                    </option>
                  ))
                ) : (
                  <option value="0">Chưa có lớp</option>
                )}
              </select>
            </div>
            <div className="row">
              <button className="btn" onClick={refreshStudentViews}>Làm mới dữ liệu</button>
            </div>

            <div className="statGrid">
              <div className="statCard">
                <div className="statLabel">Tổng token ví (LRT)</div>
                <div className="statValue">{studentTokenBalance} <span className="statUnit">LRT</span></div>
                <div className="statNote">Tổng mọi lớp · +1 điểm danh · +5 bài tập</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Số buổi điểm danh (lớp này)</div>
                <div className="statValue">{studentAttendanceCount}</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Chứng nhận NFT (lớp này)</div>
                <div className="statValue">{studentCertificateBalance}</div>
                <div className="statNote">
                  {Number(studentCertificateBalance) > 0 ? "Đã được cấp cho lớp này" : "Chưa cấp cho lớp này"}
                </div>
              </div>
              <div className="statCard">
                <div className="statLabel">Bài tập đã hoàn thành (lớp này)</div>
                <div className="statValue">
                  {studentCompletedAssignmentIds.length
                    ? studentCompletedAssignmentIds.join(", ")
                    : "—"}
                </div>
                <div className="statNote">ID bài tập</div>
              </div>
            </div>

            {cachedCertificateTokenId ? (
              <div className="small" style={{ marginTop: 10 }}>
                TokenId chứng nhận (đã lưu): <span className="mono">{cachedCertificateTokenId}</span>
              </div>
            ) : null}
          </div>

          <div className="card">
            <h2>Lịch sử điểm danh (10 buổi gần nhất)</h2>
            {studentHistory.length ? (
              studentHistory.map((h, idx) => (
                <div key={idx} className="listItem">
                  <div>
                    <div className="listTitle">{h.present ? "Có mặt" : "Vắng mặt"}</div>
                    <div className="small">{new Date(h.timestamp * 1000).toLocaleString()}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="small">Chưa có dữ liệu điểm danh cho lớp này.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

