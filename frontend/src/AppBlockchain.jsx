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
import {
  connectMetaMaskSepolia,
  getConnectedMetaMask,
  ensureSepolia,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CONTRACTS,
  SEPOLIA_EXPLORER,
  explorerAddressUrl,
  explorerTxUrl,
} from "./lib/wallet";

const TEACHER_FLOWS = [
  { id: "class", label: "Lớp học", short: "Lớp" },
  { id: "enroll", label: "Học viên", short: "HV" },
  { id: "attendance", label: "Điểm danh", short: "Điểm danh" },
  { id: "assignment", label: "Bài tập", short: "Bài tập" },
  { id: "certificate", label: "Chứng nhận", short: "CN" },
];

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
  ["Already enrolled", "Học viên này đã được đăng ký vào lớp rồi."],
  ["Student not enrolled", "Học viên chưa được đăng ký vào lớp."],
  ["Class not active", "Lớp không còn hoạt động."],
  ["Outside class period", "Ngoài thời gian học của lớp. Kiểm tra ngày bắt đầu/kết thúc."],
  ["Already completed", "Học viên đã hoàn thành bài tập này rồi."],
  ["Certificate already issued", "Chứng nhận đã được cấp cho học viên này."],
  ["No attendance", "Cần điểm danh ít nhất 1 buổi trước khi cấp chứng nhận."],
  ["Assignments not completed", "Học viên chưa hoàn thành hết bài tập của lớp."],
  ["Invalid dates", "Ngày kết thúc phải sau ngày bắt đầu."],
  ["AccessControlUnauthorizedAccount", "Ví không có quyền Teacher."],
  ["user rejected", "Bạn đã hủy giao dịch trên MetaMask."],
  ["ACTION_REJECTED", "Bạn đã hủy giao dịch trên MetaMask."],
  ["insufficient funds", "Ví không đủ ETH để trả phí gas."],
  ["network changed", "Mạng MetaMask đã đổi. Hãy Connect lại."],
  ["ECONNREFUSED", "Không kết nối được máy chủ blockchain local. Hãy khởi động lại node rồi thử lại."],
  ["failed to fetch", "Không kết nối được máy chủ blockchain local."],
  ["could not decode", "Dữ liệu hợp đồng không còn hợp lệ. Hãy khởi tạo lại hệ thống."],
  ["BAD_DATA", "Dữ liệu hợp đồng không còn hợp lệ. Hãy khởi tạo lại hệ thống."],
  ["CALL_EXCEPTION", "Hợp đồng không phản hồi. Hãy khởi tạo lại hệ thống."],
  ["nonce too low", "Giao dịch bị trùng. Đợi vài giây rồi thử lại."],
  ["NONCE_EXPIRED", "Giao dịch hết hiệu lực. Hãy thử lại."],
  ["replacement fee too low", "Giao dịch trùng. Đợi rồi thử lại."],
];

function friendlyError(err) {
  const raw = [
    err?.shortMessage,
    err?.reason,
    err?.info?.error?.message,
    err?.error?.message,
    err?.data?.message,
    err?.message,
    String(err ?? ""),
  ]
    .filter(Boolean)
    .join(" | ");

  console.error("[tx error]", err);

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

  // Lấy đoạn ngắn nhất có ý nghĩa thay vì nuốt hết lỗi
  const short =
    err?.shortMessage ||
    err?.reason ||
    err?.info?.error?.message ||
    err?.error?.message ||
    "";
  if (short && short.length <= 220) return short;
  if (raw.length > 220) return `${raw.slice(0, 200)}…`;
  return raw || "Đã xảy ra lỗi không xác định.";
}

/** datetime-local mặc định: giờ hiện tại → +30 ngày */
function defaultClassRange() {
  const start = new Date();
  start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
  const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  end.setMinutes(end.getMinutes() - end.getTimezoneOffset());
  return {
    start: start.toISOString().slice(0, 16),
    end: end.toISOString().slice(0, 16),
  };
}

function CardTitle({ step, title }) {
  return (
    <div className="cardHead">
      {step != null ? <span className="stepNum">{step}</span> : null}
      <h2>{title}</h2>
    </div>
  );
}

function ClassSelect({ classes, value, onChange, disabled, emptyText }) {
  return (
    <select
      className="select"
      value={value}
      disabled={disabled || !classes.length}
      onChange={(e) => onChange(e.target.value)}
    >
      {!classes.length ? (
        <option value="">{emptyText || "Chưa có lớp"}</option>
      ) : (
        classes.map((c) => (
          <option key={c.id} value={String(c.id)}>
            #{c.id} — {c.name}
          </option>
        ))
      )}
    </select>
  );
}

function StudentChecklist({ students, selected, onToggle, onSelectAll, onClear }) {
  if (!students.length) {
    return (
      <div className="historyEmpty">
        Lớp chưa có học viên. Vào mục <b>Học viên</b> để thêm trước.
      </div>
    );
  }

  return (
    <div className="studentList">
      <div className="studentListToolbar">
        <span className="small">
          Đã chọn <b>{selected.length}</b> / {students.length}
        </span>
        <div className="row" style={{ margin: 0, gap: 6 }}>
          <button type="button" className="btn btnGhost btnSm" onClick={onSelectAll}>
            Chọn tất cả
          </button>
          <button type="button" className="btn btnGhost btnSm" onClick={onClear}>
            Bỏ chọn
          </button>
        </div>
      </div>
      {students.map((s) => {
        const checked = selected.includes(s.addr);
        return (
          <label key={s.addr} className={`studentRow ${checked ? "studentRowOn" : ""}`}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(s.addr)}
            />
            <span className="studentMeta">
              <span className="listTitle">{s.name || "Chưa đặt tên"}</span>
              <span className="mono small">{shortAddr(s.addr)}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function StudentPicker({ students, value, onChange, emptyHint }) {
  if (!students.length) {
    return <div className="historyEmpty">{emptyHint || "Chưa có sinh viên trong lớp."}</div>;
  }
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Chọn sinh viên —</option>
      {students.map((s) => (
        <option key={s.addr} value={s.addr}>
          {s.name || "Học viên"} · {shortAddr(s.addr)}
        </option>
      ))}
    </select>
  );
}

export default function AppBlockchain() {
  const attendanceInterface = useMemo(
    () => new ethers.Interface(AttendanceManagerArtifact.abi),
    []
  );

  const [signerRef, setSignerRef] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [deployment, setDeployment] = useState(() => loadDeployment());
  const [contracts, setContracts] = useState(null);
  const [isTeacher, setIsTeacher] = useState(false);
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [tab, setTab] = useState("teacher");
  const [teacherFlow, setTeacherFlow] = useState("class");
  const [busy, setBusy] = useState(false);
  const [lastTxUrl, setLastTxUrl] = useState("");

  const [classes, setClasses] = useState([]);
  const [studentClasses, setStudentClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [roster, setRoster] = useState([]);
  const [classSessions, setClassSessions] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [attendanceSelected, setAttendanceSelected] = useState([]);

  const canUseContracts =
    Boolean(contracts?.attendanceManager) &&
    Boolean(contracts?.rewardToken) &&
    Boolean(contracts?.certificateNFT);

  const chainHint = useMemo(() => {
    if (chainId == null) return "Chưa kết nối ví";
    if (chainId === SEPOLIA_CHAIN_ID) return "Sepolia testnet";
    if (chainId === 31337) return "Hardhat local — hãy chuyển Sepolia";
    if (chainId === 1) return "Ethereum Mainnet — hãy chuyển Sepolia";
    return `Mạng ${chainId} — hãy chuyển Sepolia`;
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

  const [className, setClassName] = useState("");
  const [classStart, setClassStart] = useState(() => defaultClassRange().start);
  const [classEnd, setClassEnd] = useState(() => defaultClassRange().end);
  const [enrollStudentAddr, setEnrollStudentAddr] = useState("");
  const [enrollStudentName, setEnrollStudentName] = useState("");
  const [enrollNameFromChain, setEnrollNameFromChain] = useState(false);
  const [enrollAlreadyInClass, setEnrollAlreadyInClass] = useState(false);
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentDeadline, setAssignmentDeadline] = useState("");
  const [completionAssignmentId, setCompletionAssignmentId] = useState("");
  const [completionStudentAddr, setCompletionStudentAddr] = useState("");
  const [certificateStudentAddr, setCertificateStudentAddr] = useState("");

  const [studentClassId, setStudentClassId] = useState("0");
  const [studentHistory, setStudentHistory] = useState([]);
  const [studentTokenBalance, setStudentTokenBalance] = useState("0");
  const [studentAttendanceCount, setStudentAttendanceCount] = useState("0");
  const [studentCertificateBalance, setStudentCertificateBalance] = useState("0");
  const [cachedCertificateTokenId, setCachedCertificateTokenId] = useState(null);
  const [studentCompletedAssignmentIds, setStudentCompletedAssignmentIds] = useState([]);
  const [studentAssignmentTotal, setStudentAssignmentTotal] = useState(0);
  const [studentCertInfo, setStudentCertInfo] = useState(null);

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
    if (list.length && !list.some((c) => String(c.id) === String(selectedClassId))) {
      setSelectedClassId(String(list[list.length - 1].id));
    }
    return list;
  }

  async function refreshStudentClasses(attendanceManager, studentAddr, allClasses) {
    const source = allClasses || classes;
    if (!attendanceManager || !ethers.isAddress(studentAddr) || !source.length) {
      setStudentClasses([]);
      setStudentClassId("");
      return [];
    }

    const enrolledList = [];
    for (const c of source) {
      try {
        const ok = await attendanceManager.enrolled(c.id, studentAddr);
        if (ok) enrolledList.push(c);
      } catch {
        // bỏ qua lớp lỗi
      }
    }

    setStudentClasses(enrolledList);
    if (!enrolledList.length) {
      setStudentClassId("");
    } else if (!enrolledList.some((c) => String(c.id) === String(studentClassId))) {
      setStudentClassId(String(enrolledList[0].id));
    }
    return enrolledList;
  }

  async function refreshAssignments(attendanceManager, classId) {
    if (classId === "" || classId == null || Number.isNaN(Number(classId))) {
      setAssignments([]);
      return [];
    }
    const ids = await attendanceManager.getClassAssignments(Number(classId));
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
    if (list.length && !list.some((a) => a.id === completionAssignmentId)) {
      setCompletionAssignmentId(list[0].id);
    }
    if (!list.length) setCompletionAssignmentId("");
    return list;
  }

  async function refreshSessions(attendanceManager, classId) {
    if (!attendanceManager || classId === "" || classId == null) {
      setClassSessions([]);
      return [];
    }
    try {
      const list = await attendanceManager.getClassSessions(Number(classId));
      const mapped = Array.from(list || []).map((s) => ({
        sessionNumber: Number(s.sessionNumber),
        timestamp: Number(s.timestamp),
      }));
      setClassSessions(mapped);
      return mapped;
    } catch {
      setClassSessions([]);
      return [];
    }
  }

  async function refreshRoster(attendanceManager, classId) {
    if (!attendanceManager || classId === "" || classId == null) {
      setRoster([]);
      setAttendanceSelected([]);
      return [];
    }
    try {
      const addrs = await attendanceManager.getClassStudents(Number(classId));
      const list = [];
      for (const addr of addrs) {
        const info = await attendanceManager.students(addr);
        list.push({
          addr,
          name: info.name || "",
          registered: Boolean(info.registered),
        });
      }
      setRoster(list);
      setAttendanceSelected((prev) => prev.filter((a) => list.some((s) => s.addr === a)));
      if (completionStudentAddr && !list.some((s) => s.addr === completionStudentAddr)) {
        setCompletionStudentAddr("");
      }
      if (certificateStudentAddr && !list.some((s) => s.addr === certificateStudentAddr)) {
        setCertificateStudentAddr("");
      }
      return list;
    } catch (e) {
      setRoster([]);
      throw e;
    }
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

  async function tryLoadContracts(signer, addr, netChainId) {
    let dep = loadDeployment();

    if (
      netChainId === SEPOLIA_CHAIN_ID &&
      SEPOLIA_CONTRACTS &&
      (!dep || dep.chainId !== SEPOLIA_CHAIN_ID)
    ) {
      dep = {
        chainId: SEPOLIA_CHAIN_ID,
        addresses: { ...SEPOLIA_CONTRACTS },
        deployedAt: Date.now(),
        source: "sepolia-preset",
      };
      saveDeployment(dep);
    }

    if (!dep || dep.chainId !== netChainId) {
      setContracts(null);
      setClasses([]);
      setAssignments([]);
      setRoster([]);
      setClassSessions([]);
      setIsTeacher(false);
      setDeployment(null);
      return false;
    }

    try {
      const instances = createContractInstances(signer, dep.addresses);
      await instances.attendanceManager.classCount();
      setContracts(instances);
      setDeployment(dep);
      await refreshClasses(instances.attendanceManager);
      const teacher = await refreshTeacherRole(instances.attendanceManager, addr);
      setTab(teacher ? "teacher" : "student");
      return true;
    } catch {
      setContracts(null);
      setClasses([]);
      setAssignments([]);
      setRoster([]);
      setIsTeacher(false);
      setErr("Không tải được hợp đồng. Kiểm tra mạng Sepolia và thử kết nối lại.");
      return false;
    }
  }

  async function bindSigner(conn) {
    setSignerRef(conn.signer);
    setAccount(conn.address);
    setChainId(conn.chainId);
    await tryLoadContracts(conn.signer, conn.address, conn.chainId);
  }

  async function handleConnect() {
    try {
      setBusy(true);
      setStatus({ type: "idle", message: "Đang kết nối MetaMask (Sepolia)..." });
      const conn = await connectMetaMaskSepolia();
      await bindSigner(conn);
      setOk(`Đã kết nối ${shortAddr(conn.address)} trên Sepolia`);
    } catch (e) {
      handleErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function doDeploy() {
    if (!signerRef) return setErr("Vui lòng kết nối ví trước");

    try {
      setBusy(true);
      clearDeployment();
      setContracts(null);
      setStatus({
        type: "idle",
        message: "Đang triển khai hợp đồng — confirm từng giao dịch trên MetaMask...",
      });

      const depAddresses = await deployAll(signerRef);
      const nextDeployment = {
        chainId: Number(chainId),
        addresses: depAddresses,
        deployedAt: Date.now(),
      };

      saveDeployment(nextDeployment);
      setDeployment(nextDeployment);

      const instances = createContractInstances(signerRef, depAddresses);
      setContracts(instances);

      await refreshClasses(instances.attendanceManager);
      await refreshTeacherRole(instances.attendanceManager, account);
      setTab("teacher");
      setTeacherFlow("class");
      setIsTeacher(true);
      setOk("Đã triển khai hợp đồng trên Sepolia.");
      setLastTxUrl(explorerAddressUrl(depAddresses.attendanceManager));
    } catch (e) {
      handleErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function withTx(message, fn) {
    if (!canUseContracts) return;
    try {
      setBusy(true);
      setLastTxUrl("");
      setStatus({ type: "idle", message: `${message} — confirm trên MetaMask...` });
      const maybeHash = await fn();
      if (maybeHash && typeof maybeHash === "string" && maybeHash.startsWith("0x")) {
        setLastTxUrl(explorerTxUrl(maybeHash));
      }
    } catch (e) {
      handleErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateClass() {
    const startTs = toUnixSeconds(classStart);
    const endTs = toUnixSeconds(classEnd);
    if (!className.trim()) return setErr("Vui lòng nhập tên lớp");
    if (!startTs || !endTs) return setErr("Vui lòng chọn thời gian bắt đầu và kết thúc");

    await withTx("Đang tạo lớp", async () => {
      const tx = await contracts.attendanceManager.createClass(className, startTs, endTs);
      await tx.wait();
      const list = await refreshClasses(contracts.attendanceManager);
      if (list.length) {
        const id = String(list[list.length - 1].id);
        setSelectedClassId(id);
        setStudentClassId(id);
      }
      setClassName("");
      setOk("Đã tạo lớp học.");
      setTeacherFlow("enroll");
      return tx.hash;
    });
  }

  async function handleEnroll() {
    if (!selectedClassId) return setErr("Vui lòng chọn lớp");
    if (!ethers.isAddress(enrollStudentAddr)) return setErr("Địa chỉ ví học viên không hợp lệ");

    await withTx("Đang thêm học viên", async () => {
      const tx = await contracts.attendanceManager.enrollStudent(
        Number(selectedClassId),
        enrollStudentAddr,
        enrollStudentName || "Student"
      );
      await tx.wait();
      await refreshRoster(contracts.attendanceManager, selectedClassId);
      setEnrollStudentAddr("");
      setEnrollStudentName("");
      setEnrollNameFromChain(false);
      setEnrollAlreadyInClass(false);
      setOk("Đã thêm học viên vào lớp.");
      return tx.hash;
    });
  }

  async function handleMarkAttendance() {
    if (!selectedClassId) return setErr("Vui lòng chọn lớp");
    if (!attendanceSelected.length) return setErr("Chọn ít nhất một học viên");

    await withTx("Đang điểm danh", async () => {
      const count = attendanceSelected.length;
      const tx = await contracts.attendanceManager.markAttendance(
        Number(selectedClassId),
        attendanceSelected
      );
      await tx.wait();
      const sessions = await refreshSessions(contracts.attendanceManager, selectedClassId);
      const last = sessions[sessions.length - 1];
      setAttendanceSelected([]);
      setOk(
        last
          ? `Đã điểm danh Buổi ${last.sessionNumber} · ${count} học viên.`
          : `Đã điểm danh ${count} học viên.`
      );
      return tx.hash;
    });
  }

  async function handleCreateAssignment() {
    if (!selectedClassId) return setErr("Vui lòng chọn lớp");
    const deadlineTs = toUnixSeconds(assignmentDeadline);
    if (!assignmentTitle.trim()) return setErr("Vui lòng nhập tiêu đề bài tập");
    if (!deadlineTs) return setErr("Vui lòng chọn hạn nộp");

    await withTx("Đang tạo bài tập", async () => {
      const tx = await contracts.attendanceManager.createAssignment(
        Number(selectedClassId),
        assignmentTitle,
        deadlineTs
      );
      await tx.wait();
      await refreshAssignments(contracts.attendanceManager, selectedClassId);
      setAssignmentTitle("");
      setOk("Đã tạo bài tập.");
      return tx.hash;
    });
  }

  async function handleRecordCompletion() {
    if (!completionAssignmentId) return setErr("Vui lòng chọn bài tập");
    if (!ethers.isAddress(completionStudentAddr)) return setErr("Vui lòng chọn học viên");

    await withTx("Đang ghi nhận hoàn thành", async () => {
      const tx = await contracts.attendanceManager.recordAssignmentCompletion(
        Number(completionAssignmentId),
        completionStudentAddr
      );
      await tx.wait();
      setOk("Đã ghi nhận hoàn thành bài tập.");
      return tx.hash;
    });
  }

  async function handleIssueCertificate() {
    if (!selectedClassId) return setErr("Vui lòng chọn lớp");
    if (!ethers.isAddress(certificateStudentAddr)) return setErr("Vui lòng chọn học viên");

    await withTx("Đang cấp chứng nhận", async () => {
      const tx = await contracts.attendanceManager.issueCertificate(
        Number(selectedClassId),
        certificateStudentAddr
      );
      const receipt = await tx.wait();
      const tokenId = parseCertificateIssuedTokenId(attendanceInterface, receipt);
      if (tokenId != null) {
        saveStudentCertificateTokenId(
          Number(chainId ?? 0),
          Number(selectedClassId),
          certificateStudentAddr,
          tokenId
        );
      }
      setOk(tokenId != null ? `Đã cấp chứng nhận (#${tokenId}).` : "Đã cấp chứng nhận.");
      return tx.hash;
    });
  }

  async function refreshStudentViews() {
    if (!canUseContracts) return;
    if (!ethers.isAddress(account)) return;
    if (studentClassId === "" || studentClassId == null) {
      setOk("Bạn chưa được thêm vào lớp nào.");
      return;
    }

    const cid = Number(studentClassId);
    try {
      setStatus({ type: "idle", message: "Đang tải dữ liệu học tập..." });
      setStudentAttendanceCount("0");
      setStudentHistory([]);
      setStudentCompletedAssignmentIds([]);
      setStudentAssignmentTotal(0);
      setCachedCertificateTokenId(null);
      setStudentCertificateBalance("0");
      setStudentCertInfo(null);

      const [bal, attendCount, certForClass, enrolledHere, history, completedAssignmentIds, classAssignmentIds] =
        await Promise.all([
          contracts.rewardToken.balanceOf(account),
          contracts.attendanceManager.getStudentAttendanceCount(cid, account),
          contracts.attendanceManager.certificateIssued(cid, account),
          contracts.attendanceManager.enrolled(cid, account),
          contracts.attendanceManager.getAttendanceHistory(cid, account),
          contracts.attendanceManager.getCompletedAssignments(cid, account),
          contracts.attendanceManager.getClassAssignments(cid),
        ]);

      const completed = Array.from(completedAssignmentIds || [], (id) => id.toString());
      const total = Array.from(classAssignmentIds || []).length;

      setStudentTokenBalance(formatToken(bal));
      setStudentAttendanceCount(formatBigInt(attendCount));
      setStudentCertificateBalance(certForClass ? "1" : "0");
      setStudentHistory(
        history.slice(-20).map((r) => ({
          timestamp: Number(r.timestamp),
          present: Boolean(r.present),
          sessionNumber: Number(r.sessionNumber ?? 0),
        }))
      );
      setStudentCompletedAssignmentIds(completed);
      setStudentAssignmentTotal(total);

      const cachedId = loadStudentCertificateTokenId(Number(chainId ?? 0), cid, account);
      setCachedCertificateTokenId(cachedId);

      if (certForClass && cachedId != null) {
        try {
          const cert = await contracts.certificateNFT.getCertificate(cachedId);
          const rate = Number(await contracts.certificateNFT.attendanceRate(cachedId));
          setStudentCertInfo({
            tokenId: cachedId,
            className: cert.className,
            studentName: cert.studentName,
            attendanceCount: Number(cert.attendanceCount),
            totalSessions: Number(cert.totalSessions),
            rate,
            completionDate: Number(cert.completionDate),
          });
        } catch {
          setStudentCertInfo(null);
        }
      }

      setOk(
        enrolledHere
          ? "Đã cập nhật thông tin học tập."
          : "Bạn chưa được đăng ký vào lớp này."
      );
    } catch (e) {
      handleErr(e);
    }
  }

  function toggleAttendance(addr) {
    setAttendanceSelected((prev) =>
      prev.includes(addr) ? prev.filter((a) => a !== addr) : [...prev, addr]
    );
  }

  useEffect(() => {
    if (!canUseContracts) return;
    refreshClasses(contracts.attendanceManager).catch(handleErr);
  }, [canUseContracts]);

  useEffect(() => {
    if (!canUseContracts || isTeacher || !ethers.isAddress(account)) {
      if (isTeacher) setStudentClasses([]);
      return;
    }
    refreshStudentClasses(contracts.attendanceManager, account, classes).catch(handleErr);
  }, [canUseContracts, isTeacher, account, classes]);

  useEffect(() => {
    if (!canUseContracts || !selectedClassId) return;
    refreshAssignments(contracts.attendanceManager, selectedClassId).catch(handleErr);
    refreshRoster(contracts.attendanceManager, selectedClassId).catch(handleErr);
    refreshSessions(contracts.attendanceManager, selectedClassId).catch(handleErr);
  }, [canUseContracts, selectedClassId]);

  useEffect(() => {
    if (!canUseContracts) return;
    if (isTeacher && tab !== "teacher") setTab("teacher");
    if (!isTeacher && tab !== "student") setTab("student");
  }, [canUseContracts, isTeacher]);

  async function lookupEnrollStudent(addr) {
    if (!canUseContracts || !ethers.isAddress(addr)) {
      setEnrollNameFromChain(false);
      setEnrollAlreadyInClass(false);
      return;
    }

    // Nhanh: đã có trong roster lớp hiện tại
    const inRoster = roster.some((s) => s.addr.toLowerCase() === addr.toLowerCase());
    if (inRoster) setEnrollAlreadyInClass(true);

    try {
      const tasks = [contracts.attendanceManager.students(addr)];
      if (selectedClassId !== "" && selectedClassId != null) {
        tasks.push(contracts.attendanceManager.enrolled(Number(selectedClassId), addr));
      }
      const [info, already] = await Promise.all(tasks);
      if (info.registered && info.name) {
        setEnrollStudentName(info.name);
        setEnrollNameFromChain(true);
      } else {
        setEnrollNameFromChain(false);
      }
      if (already !== undefined) {
        setEnrollAlreadyInClass(Boolean(already) || inRoster);
      }
    } catch {
      setEnrollNameFromChain(false);
      if (!inRoster) setEnrollAlreadyInClass(false);
    }
  }

  function onEnrollAddrChange(value) {
    setEnrollStudentAddr(value);
    setEnrollNameFromChain(false);
    const trimmed = value.trim();
    if (ethers.isAddress(trimmed)) {
      lookupEnrollStudent(trimmed);
    } else {
      setEnrollAlreadyInClass(false);
    }
  }

  useEffect(() => {
    const trimmed = enrollStudentAddr.trim();
    if (ethers.isAddress(trimmed)) {
      lookupEnrollStudent(trimmed);
    } else {
      setEnrollAlreadyInClass(false);
    }
  }, [selectedClassId, roster, canUseContracts]);

  useEffect(() => {
    if (!canUseContracts || tab !== "student") return;
    if (!ethers.isAddress(account)) return;
    refreshStudentViews().catch(() => {});
  }, [canUseContracts, tab, studentClassId, account]);

  useEffect(() => {
    if (!window.ethereum?.on) return undefined;

    const onAccountsChanged = async (accounts) => {
      if (!accounts?.length) {
        setAccount("");
        setSignerRef(null);
        setContracts(null);
        setIsTeacher(false);
        setOk("Đã ngắt kết nối ví.");
        return;
      }
      try {
        const conn = await getConnectedMetaMask();
        if (!conn) return;
        if (conn.chainId !== SEPOLIA_CHAIN_ID) {
          await ensureSepolia();
          await handleConnect();
          return;
        }
        await bindSigner(conn);
        setOk(`Đã đổi ví: ${shortAddr(conn.address)}`);
      } catch (e) {
        handleErr(e);
      }
    };

    const onChainChanged = () => window.location.reload();

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const selectedClassHint = classLabel(
    tab === "student" ? studentClasses : classes,
    tab === "student" ? studentClassId : selectedClassId
  );

  return (
    <div className="appRoot">
      <header className="topBar">
        <div className="brandBlock">
          <div className="brandMark" aria-hidden>
            ĐD
          </div>
          <div>
            <div className="appTitle">Điểm danh học tập</div>
            <div className="appSubtitle">{chainHint}</div>
          </div>
        </div>

        <div className="topActions">
          {account ? (
            <div className="walletChip">
              <span className="small">{isTeacher ? "Giáo viên" : "Học viên"}</span>
              <span className="mono">{shortAddr(account)}</span>
            </div>
          ) : null}

          {account && deployment?.addresses?.attendanceManager ? (
            <a
              className="btn btnGhost btnSm"
              href={explorerAddressUrl(deployment.addresses.attendanceManager)}
              target="_blank"
              rel="noreferrer"
            >
              Etherscan
            </a>
          ) : null}

          <button type="button" className="btn btnSm" disabled={busy} onClick={handleConnect}>
            {account ? "Kết nối lại" : "Kết nối MetaMask"}
          </button>
        </div>
      </header>

      {account && canUseContracts ? (
        <div className="roleHint">
          <span>
            Vai trò theo ví: <strong>{isTeacher ? "Giáo viên" : "Học viên"}</strong>
            {selectedClassId ? (
              <>
                {" "}
                · Lớp: <strong>{selectedClassHint}</strong>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {status.message ? (
        <div
          className={
            status.type === "ok" ? "statusOk" : status.type === "err" ? "statusErr" : "statusIdle"
          }
        >
          {status.message}
          {lastTxUrl && status.type === "ok" ? (
            <>
              {" "}
              <a href={lastTxUrl} target="_blank" rel="noreferrer">
                Xem trên Etherscan
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {!account ? (
        <div className="card connectCard">
          <CardTitle title="Đăng nhập" />
          <p className="hint" style={{ textAlign: "center", marginBottom: 0 }}>
            Kết nối MetaMask trên mạng <b>Sepolia</b>. Vai trò Giáo viên / Học viên lấy theo quyền
            trên hợp đồng.
          </p>
          <div className="connectActions">
            <button type="button" className="btn" disabled={busy} onClick={handleConnect}>
              Kết nối MetaMask · Sepolia
            </button>
          </div>
          <div className="infoCallout">
            Mỗi thao tác cần confirm trên MetaMask. Lịch sử giao dịch xem tại{" "}
            <a href={SEPOLIA_EXPLORER} target="_blank" rel="noreferrer">
              Sepolia Etherscan
            </a>
            .
          </div>
        </div>
      ) : !canUseContracts ? (
        <div className="card connectCard">
          <CardTitle title="Chưa gắn được hợp đồng" />
          <p className="hint">
            Ví đã kết nối nhưng chưa tải được hệ thống. Hãy chắc MetaMask đang ở <b>Sepolia</b>, rồi
            kết nối lại.
          </p>
          <div className="connectActions">
            <button type="button" className="btn" disabled={busy} onClick={handleConnect}>
              Kết nối lại Sepolia
            </button>
          </div>
        </div>
      ) : tab === "teacher" && isTeacher ? (
          <>
            <nav className="flowNav" aria-label="Chức năng giáo viên">
              {TEACHER_FLOWS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`flowBtn ${teacherFlow === f.id ? "flowBtnActive" : ""}`}
                  onClick={() => setTeacherFlow(f.id)}
                >
                  <span className="flowBtnFull">{f.label}</span>
                  <span className="flowBtnShort">{f.short}</span>
                </button>
              ))}
            </nav>

            {teacherFlow !== "class" ? (
              <div className="classBar">
                <div className="label">Lớp</div>
                <ClassSelect
                  classes={classes}
                  value={selectedClassId}
                  emptyText="Chưa có lớp — hãy tạo lớp trước"
                  onChange={(id) => {
                    setSelectedClassId(id);
                    setStudentClassId(id);
                    setAttendanceSelected([]);
                  }}
                />
                <span className="small">{roster.length} học viên</span>
              </div>
            ) : null}

            {teacherFlow === "class" ? (
              <div className="grid2">
                <div className="card">
                  <CardTitle title="Tạo lớp học" />
                  <p className="hint">Nhập tên và thời gian học của lớp.</p>
                  <div className="row">
                    <div className="label">Tên lớp</div>
                    <input
                      className="input"
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      placeholder="Ví dụ: Blockchain ứng dụng"
                    />
                  </div>
                  <div className="row">
                    <div className="label">Bắt đầu</div>
                    <input
                      className="input"
                      type="datetime-local"
                      value={classStart}
                      onChange={(e) => setClassStart(e.target.value)}
                    />
                  </div>
                  <div className="row">
                    <div className="label">Kết thúc</div>
                    <input
                      className="input"
                      type="datetime-local"
                      value={classEnd}
                      onChange={(e) => setClassEnd(e.target.value)}
                    />
                  </div>
                  <div className="row">
                    <button type="button" className="btn" disabled={busy} onClick={handleCreateClass}>
                      Tạo lớp
                    </button>
                  </div>
                </div>

                <div className="card">
                  <CardTitle title="Lớp của bạn" />
                  <p className="hint">Chọn một lớp để quản lý học viên và điểm danh.</p>
                  {classes.length ? (
                    classes.map((c) => (
                      <div key={c.id} className="listItem">
                        <div>
                          <div className="listTitle">{c.name}</div>
                          <div className="small">
                            {new Date(c.startDate * 1000).toLocaleString()} →{" "}
                            {new Date(c.endDate * 1000).toLocaleString()}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btnSm"
                          onClick={() => {
                            setSelectedClassId(String(c.id));
                            setStudentClassId(String(c.id));
                            setTeacherFlow("enroll");
                          }}
                        >
                          Quản lý
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="historyEmpty">Chưa có lớp học nào.</div>
                  )}
                </div>
              </div>
            ) : null}

            {teacherFlow === "enroll" ? (
              <div className="grid2">
                <div className="card">
                  <CardTitle title="Thêm học viên" />
                  <p className="hint">
                    Thêm học viên vào lớp <b>{classLabel(classes, selectedClassId)}</b>.
                  </p>

                  <div className="field">
                    <div className="fieldLabel">Địa chỉ ví</div>
                    <input
                      className="input"
                      value={enrollStudentAddr}
                      onChange={(e) => onEnrollAddrChange(e.target.value)}
                      placeholder="0x... (địa chỉ MetaMask của học viên)"
                    />
                  </div>

                  <div className="field">
                    <div className="fieldLabel">Họ tên</div>
                    <input
                      className="input"
                      value={enrollStudentName}
                      onChange={(e) => {
                        setEnrollStudentName(e.target.value);
                        setEnrollNameFromChain(false);
                      }}
                      placeholder="Nguyễn Văn A"
                    />
                    {enrollNameFromChain ? (
                      <div className="small">Đã tải tên đã lưu theo địa chỉ ví này.</div>
                    ) : null}
                    {enrollAlreadyInClass ? (
                      <div className="small" style={{ color: "var(--err)" }}>
                        Học viên này đã có trong lớp — không thể thêm lại.
                      </div>
                    ) : null}
                  </div>

                  <div className="row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !selectedClassId || enrollAlreadyInClass || !ethers.isAddress(enrollStudentAddr.trim())}
                      onClick={handleEnroll}
                    >
                      {enrollAlreadyInClass ? "Đã có trong lớp" : "Thêm vào lớp"}
                    </button>
                    <button
                      type="button"
                      className="btn btnGhost"
                      onClick={() => setTeacherFlow("attendance")}
                    >
                      Điểm danh
                    </button>
                  </div>
                </div>

                <div className="card">
                  <CardTitle title="Danh sách học viên" />
                  <p className="hint">Các học viên đã đăng ký trong lớp này.</p>
                  {roster.length ? (
                    roster.map((s) => (
                      <div key={s.addr} className="listItem">
                        <div>
                          <div className="listTitle">{s.name || "Học viên"}</div>
                          <div className="mono small">{s.addr}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="historyEmpty">Chưa có học viên trong lớp.</div>
                  )}
                </div>
              </div>
            ) : null}

            {teacherFlow === "attendance" ? (
              <div className="grid2">
                <div className="card">
                  <CardTitle title="Điểm danh buổi học" />
                  <p className="hint">
                    Mỗi lần xác nhận tạo <b>một buổi</b> (Buổi {classSessions.length + 1}). Chọn học
                    viên có mặt rồi xác nhận.
                  </p>
                  <StudentChecklist
                    students={roster}
                    selected={attendanceSelected}
                    onToggle={toggleAttendance}
                    onSelectAll={() => setAttendanceSelected(roster.map((s) => s.addr))}
                    onClear={() => setAttendanceSelected([])}
                  />
                  <div className="row" style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !attendanceSelected.length}
                      onClick={handleMarkAttendance}
                    >
                      Điểm danh Buổi {classSessions.length + 1} ({attendanceSelected.length} HV)
                    </button>
                  </div>
                </div>

                <div className="card">
                  <CardTitle title="Các buổi đã điểm danh" />
                  <p className="hint">Lịch sử buổi học của lớp đang chọn.</p>
                  {classSessions.length ? (
                    [...classSessions].reverse().map((s) => (
                      <div key={s.sessionNumber} className="listItem">
                        <div>
                          <div className="listTitle">Buổi {s.sessionNumber}</div>
                          <div className="small">
                            {new Date(s.timestamp * 1000).toLocaleString("vi-VN")}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="historyEmpty">Chưa có buổi điểm danh nào.</div>
                  )}
                </div>
              </div>
            ) : null}

            {teacherFlow === "assignment" ? (
              <div className="grid2">
                <div className="card">
                  <CardTitle title="Tạo bài tập" />
                  <p className="hint">
                    Giao bài tập cho lớp <b>{classLabel(classes, selectedClassId)}</b>.
                  </p>
                  <div className="row">
                    <div className="label">Tiêu đề</div>
                    <input
                      className="input"
                      value={assignmentTitle}
                      onChange={(e) => setAssignmentTitle(e.target.value)}
                      placeholder="Bài tập tuần 1"
                    />
                  </div>
                  <div className="row">
                    <div className="label">Hạn nộp</div>
                    <input
                      className="input"
                      type="datetime-local"
                      value={assignmentDeadline}
                      onChange={(e) => setAssignmentDeadline(e.target.value)}
                    />
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !selectedClassId}
                      onClick={handleCreateAssignment}
                    >
                      Tạo bài tập
                    </button>
                  </div>

                  <div className="sectionDivider" />
                  <div className="listTitle">Bài tập hiện có</div>
                  {assignments.length ? (
                    assignments.map((a) => (
                      <div key={a.id} className="listItem">
                        <div>
                          <div className="listTitle">{a.title}</div>
                          <div className="small">
                            Hạn: {new Date(Number(a.deadline) * 1000).toLocaleString()}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btnSm"
                          onClick={() => setCompletionAssignmentId(a.id)}
                        >
                          Chọn
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="small">Chưa có bài tập.</div>
                  )}
                </div>

                <div className="card">
                  <CardTitle title="Ghi nhận hoàn thành" />
                  <p className="hint">Đánh dấu học viên đã hoàn thành bài tập.</p>
                  <div className="row">
                    <div className="label">Bài tập</div>
                    <select
                      className="select"
                      value={completionAssignmentId}
                      onChange={(e) => setCompletionAssignmentId(e.target.value)}
                      disabled={!assignments.length}
                    >
                      {!assignments.length ? (
                        <option value="">Chưa có bài tập</option>
                      ) : (
                        assignments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="row">
                    <div className="label">Học viên</div>
                    <StudentPicker
                      students={roster}
                      value={completionStudentAddr}
                      onChange={setCompletionStudentAddr}
                      emptyHint="Thêm học viên vào lớp trước."
                    />
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !completionAssignmentId || !completionStudentAddr}
                      onClick={handleRecordCompletion}
                    >
                      Xác nhận hoàn thành
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {teacherFlow === "certificate" ? (
              <div className="card">
                <CardTitle title="Cấp chứng nhận" />
                <p className="hint">
                  Cấp chứng nhận hoàn thành lớp cho học viên đủ điều kiện (đã điểm danh và hoàn
                  thành bài tập, nếu có).
                </p>
                <div className="row">
                  <div className="label">Học viên</div>
                  <StudentPicker
                    students={roster}
                    value={certificateStudentAddr}
                    onChange={setCertificateStudentAddr}
                  />
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !certificateStudentAddr}
                    onClick={handleIssueCertificate}
                  >
                    Cấp chứng nhận
                  </button>
                </div>
              </div>
            ) : null}
          </>
      ) : (
        <div className="grid2">
          <div className="card">
            <CardTitle title="Kết quả học tập" />
            <p className="hint">
              Lớp: <b>{selectedClassHint}</b>
            </p>
            <div className="row">
              <div className="label">Chọn lớp</div>
              <ClassSelect
                classes={studentClasses}
                value={studentClassId}
                emptyText="Bạn chưa được thêm vào lớp nào"
                onChange={(id) => {
                  setStudentClassId(id);
                  setStudentAttendanceCount("0");
                  setStudentHistory([]);
                  setStudentCompletedAssignmentIds([]);
                  setStudentAssignmentTotal(0);
                  setCachedCertificateTokenId(null);
                  setStudentCertificateBalance("0");
                  setStudentCertInfo(null);
                }}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await refreshStudentClasses(contracts.attendanceManager, account, classes);
                  await refreshStudentViews();
                }}
              >
                Làm mới
              </button>
            </div>

            <div className="statGrid">
              <div className="statCard">
                <div className="statLabel">Token thưởng (LRT)</div>
                <div className="statValue">
                  {studentTokenBalance} <span className="statUnit">LRT</span>
                </div>
                <div className="statNote">Nhận khi điểm danh và hoàn thành bài tập</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Số buổi có mặt</div>
                <div className="statValue">{studentAttendanceCount}</div>
              </div>
              <div className="statCard">
                <div className="statLabel">Chứng nhận</div>
                <div className="statValue">
                  {Number(studentCertificateBalance) > 0 ? "Đã nhận" : "Chưa có"}
                </div>
              </div>
              <div className="statCard">
                <div className="statLabel">Bài tập</div>
                <div className="statValue">
                  {studentAssignmentTotal === 0
                    ? "—"
                    : `${studentCompletedAssignmentIds.length}/${studentAssignmentTotal}`}
                </div>
                <div className="statNote">
                  {studentAssignmentTotal === 0
                    ? "Lớp chưa giao bài tập"
                    : studentCompletedAssignmentIds.length >= studentAssignmentTotal
                      ? "Đã hoàn thành tất cả"
                      : "Đã làm / tổng bài của lớp"}
                </div>
              </div>
            </div>

            {cachedCertificateTokenId || studentCertInfo ? (
              <div className="certCard">
                <div className="listTitle">Chứng nhận hoàn thành</div>
                {studentCertInfo ? (
                  <>
                    <div className="small" style={{ marginTop: 8 }}>
                      Học viên: <b>{studentCertInfo.studentName || "—"}</b>
                    </div>
                    <div className="small">
                      Lớp: <b>{studentCertInfo.className || "—"}</b>
                    </div>
                    <div className="small">
                      Chuyên cần: <b>{studentCertInfo.rate}%</b> (
                      {studentCertInfo.attendanceCount}/{studentCertInfo.totalSessions} buổi)
                    </div>
                    <div className="small">
                      Ngày cấp:{" "}
                      {new Date(studentCertInfo.completionDate * 1000).toLocaleString("vi-VN")}
                    </div>
                    <div className="small">
                      TokenId: <span className="mono">{studentCertInfo.tokenId}</span>
                    </div>
                  </>
                ) : (
                  <div className="small" style={{ marginTop: 8 }}>
                    TokenId: <span className="mono">{cachedCertificateTokenId}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="card">
            <CardTitle title="Lịch sử điểm danh" />
            <p className="hint">Các buổi bạn đã được điểm danh.</p>
            {studentHistory.length ? (
              studentHistory.map((h, idx) => (
                <div key={idx} className="listItem">
                  <div>
                    <div className="listTitle">
                      {h.present ? <span className="presentDot" /> : null}
                      {h.sessionNumber
                        ? `Buổi ${h.sessionNumber}`
                        : h.present
                          ? "Có mặt"
                          : "Vắng mặt"}
                      {h.present && h.sessionNumber ? " · Có mặt" : null}
                    </div>
                    <div className="small">
                      {new Date(h.timestamp * 1000).toLocaleString("vi-VN")}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="historyEmpty">Chưa có lịch sử điểm danh.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
