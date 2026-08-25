import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import "./App.css";

import AttendanceManagerArtifact from "./artifacts/AttendanceManager.json";
import {
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

export default function AppBlockchain() {
  const attendanceInterface = useMemo(
    () => new ethers.Interface(AttendanceManagerArtifact.abi),
    []
  );

  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [deployment, setDeployment] = useState(() => loadDeployment());
  const [contracts, setContracts] = useState(null);
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
      } else {
        setContracts(null);
        setClasses([]);
        setAssignments([]);
      }

      setOk(`Kết nối thành công: ${addr}`);
    } catch (e) {
      setErr(e?.message || String(e));
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
          setErr(addErr?.message || String(addErr));
        }
      } else {
        setErr(e?.message || String(e));
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
      setOk("Deploy xong.");
    } catch (e) {
      setErr(e?.message || String(e));
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
      setErr(e?.message || String(e));
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
      setErr(e?.message || String(e));
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
      setErr(e?.message || String(e));
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
      setErr(e?.message || String(e));
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
      setErr(e?.message || String(e));
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
      setErr(e?.message || String(e));
    }
  }

  async function refreshStudentViews() {
    if (!canUseContracts) return;
    if (!ethers.isAddress(account)) return;

    const cid = Number(studentClassId);
    try {
      setStatus({ type: "idle", message: "Đang load dữ liệu học tập..." });

      const bal = await contracts.rewardToken.balanceOf(account);
      const attendCount = await contracts.attendanceManager.getStudentAttendanceCount(cid, account);
      const certBal = await contracts.certificateNFT.balanceOf(account);

      setStudentTokenBalance(formatBigInt(bal));
      setStudentAttendanceCount(formatBigInt(attendCount));
      setStudentCertificateBalance(formatBigInt(certBal));

      const history = await contracts.attendanceManager.getAttendanceHistory(cid, account);
      const last = history.slice(-10).map((r) => ({
        timestamp: Number(r.timestamp),
        present: Boolean(r.present),
      }));
      setStudentHistory(last);

      const completedAssignmentIds = await contracts.attendanceManager.getCompletedAssignments(
        cid,
        account
      );
      setStudentCompletedAssignmentIds(
        completedAssignmentIds.map((id) => id.toString())
      );

      const cachedId = loadStudentCertificateTokenId(Number(chainId ?? 0), cid, account);
      setCachedCertificateTokenId(cachedId);

      setOk("Load xong");
    } catch (e) {
      setErr(e?.message || String(e));
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

  return (
    <div className="appRoot">
      <div className="topBar">
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Attendance & Learning Tracker</div>
          <div className="small">{chainHint}</div>
        </div>

        <div className="row" style={{ margin: 0 }}>
          {account ? (
            <div className="small mono">
              {account.slice(0, 6)}...{account.slice(-4)}
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
            {account ? "Đã kết nối" : "Connect MetaMask"}
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tabBtn ${tab === "teacher" ? "tabBtnActive" : ""}`} onClick={() => setTab("teacher")}>
          Teacher
        </button>
        <button className={`tabBtn ${tab === "student" ? "tabBtnActive" : ""}`} onClick={() => setTab("student")}>
          Student
        </button>
      </div>

      {status.message ? (
        <div className={status.type === "ok" ? "statusOk" : status.type === "err" ? "statusErr" : "small"}>
          {status.message}
        </div>
      ) : null}

      {!canUseContracts ? (
        <div className="card">
          <h2>Deploy contracts</h2>
          <div className="small">
            Trước khi deploy, hãy chạy <span className="mono">npx hardhat node</span> và set MetaMask network trùng chainId (Local thường là 31337).
          </div>
          <div className="row">
            <button className="btn" onClick={doDeploy}>Deploy hợp đồng (Local)</button>
            <button
              className="btn"
              disabled={!deployment}
              onClick={() => {
                clearDeployment();
                setDeployment(null);
                setContracts(null);
                setClasses([]);
                setAssignments([]);
              }}
            >
              Xóa địa chỉ lưu
            </button>
          </div>
        </div>
      ) : tab === "teacher" ? (
        <div className="grid2">
          <div className="card">
            <h2>Tạo lớp</h2>
            <div className="row">
              <div className="label">Tên lớp</div>
              <input className="input" value={className} onChange={(e) => setClassName(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Start</div>
              <input className="input" type="datetime-local" value={classStart} onChange={(e) => setClassStart(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">End</div>
              <input className="input" type="datetime-local" value={classEnd} onChange={(e) => setClassEnd(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn" onClick={handleCreateClass}>Create class</button>
            </div>
          </div>

          <div className="card">
            <h2>Danh sách lớp</h2>
            {classes.length ? (
              classes.map((c) => (
                <div key={c.id} className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>#{c.id} - {c.name}</div>
                    <div className="small mono">teacher: {c.teacher.slice(0, 8)}...</div>
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
            <h2>Enroll học viên</h2>
            <div className="row">
              <div className="label">ClassId</div>
              <input className="input" value={enrollClassId} onChange={(e) => setEnrollClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Student Address</div>
              <input className="input" value={enrollStudentAddr} onChange={(e) => setEnrollStudentAddr(e.target.value)} placeholder="0x..." />
            </div>
            <div className="row">
              <div className="label">Student Name</div>
              <input className="input" value={enrollStudentName} onChange={(e) => setEnrollStudentName(e.target.value)} placeholder="Tên học viên" />
            </div>
            <div className="row">
              <button className="btn" onClick={handleEnroll}>Enroll</button>
            </div>
          </div>

          <div className="card">
            <h2>Điểm danh</h2>
            <div className="row">
              <div className="label">ClassId</div>
              <input className="input" value={attendanceClassId} onChange={(e) => setAttendanceClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Students</div>
              <textarea className="textarea" value={attendanceStudents} onChange={(e) => setAttendanceStudents(e.target.value)} placeholder="Nhập mỗi dòng 1 địa chỉ hoặc phân tách bằng dấu ," />
            </div>
            <div className="row">
              <button className="btn" onClick={handleMarkAttendance}>Mark attendance</button>
            </div>
          </div>

          <div className="card">
            <h2>Bài tập</h2>
            <div className="row">
              <div className="label">ClassId</div>
              <input className="input" value={assignmentClassId} onChange={(e) => setAssignmentClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Title</div>
              <input className="input" value={assignmentTitle} onChange={(e) => setAssignmentTitle(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Deadline</div>
              <input className="input" type="datetime-local" value={assignmentDeadline} onChange={(e) => setAssignmentDeadline(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn" onClick={handleCreateAssignment}>Create assignment</button>
            </div>

            <div style={{ height: 10 }} />
            <div className="small">Assignments trong class:</div>
            <div>
              {assignments.length ? (
                assignments.map((a) => (
                  <div key={a.id} className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>#{a.id} - {a.title}</div>
                      <div className="small">deadline: {new Date(Number(a.deadline) * 1000).toLocaleString()}</div>
                    </div>
                    <button className="btn" onClick={() => setCompletionAssignmentId(a.id)}>Chọn</button>
                  </div>
                ))
              ) : (
                <div className="small">Chưa có assignment.</div>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Ghi nhận hoàn thành</h2>
            <div className="row">
              <div className="label">AssignmentId</div>
              <input className="input" value={completionAssignmentId} onChange={(e) => setCompletionAssignmentId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Student Address</div>
              <input className="input" value={completionStudentAddr} onChange={(e) => setCompletionStudentAddr(e.target.value)} placeholder="0x..." />
            </div>
            <div className="row">
              <button className="btn" onClick={handleRecordCompletion}>Record completion (+5 tokens)</button>
            </div>

            <div style={{ height: 12 }} />
            <h2 style={{ fontSize: 18, marginTop: 0 }}>Phát hành chứng nhận</h2>
            <div className="row">
              <div className="label">ClassId</div>
              <input className="input" value={certificateClassId} onChange={(e) => setCertificateClassId(e.target.value)} />
            </div>
            <div className="row">
              <div className="label">Student Address</div>
              <input className="input" value={certificateStudentAddr} onChange={(e) => setCertificateStudentAddr(e.target.value)} placeholder="0x..." />
            </div>
            <div className="row">
              <button className="btn" onClick={handleIssueCertificate}>Issue certificate (NFT)</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid2">
          <div className="card">
            <h2>Thông tin học tập</h2>
            <div className="row">
              <div className="label">ClassId</div>
              <input className="input" value={studentClassId} onChange={(e) => setStudentClassId(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn" onClick={refreshStudentViews}>Refresh</button>
            </div>
            <div style={{ height: 10 }} />
            <div className="small">
              Reward token (LRT): <span className="mono">{studentTokenBalance}</span>
            </div>
            <div className="small">
              Attendance count: <span className="mono">{studentAttendanceCount}</span>
            </div>
            <div className="small">
              Certificate NFT balance: <span className="mono">{studentCertificateBalance}</span>
            </div>
            <div className="small">
              Cached certificate tokenId (class): <span className="mono">{cachedCertificateTokenId ?? "-"}</span>
            </div>
            <div className="small">
              Completed assignments (IDs):{" "}
              <span className="mono">
                {studentCompletedAssignmentIds.length
                  ? studentCompletedAssignmentIds.join(", ")
                  : "-"}
              </span>
            </div>
          </div>

          <div className="card">
            <h2>Attendance history (last 10)</h2>
            {studentHistory.length ? (
              studentHistory.map((h, idx) => (
                <div key={idx} className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{h.present ? "Present" : "Absent"}</div>
                    <div className="small">{new Date(h.timestamp * 1000).toLocaleString()}</div>
                  </div>
                  <div className="mono small">ts:{h.timestamp}</div>
                </div>
              ))
            ) : (
              <div className="small">Chưa có dữ liệu lịch sử.</div>
            )}
          </div>
        </div>
      )}

      <div className="small">
        Demo flow: Deploy -&gt; createClass -&gt; enroll -&gt; markAttendance -&gt; createAssignment -&gt; recordCompletion -&gt; issueCertificate.
      </div>
    </div>
  );
}

