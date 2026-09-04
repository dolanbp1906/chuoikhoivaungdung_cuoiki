const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("E2E Attendance Flow", function () {
  let rewardToken, certificateNFT, attendanceManager;
  let teacher, student;

  beforeEach(async function () {
    [, teacher, student] = await ethers.getSigners();

    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy((await ethers.getSigners())[0].address);

    const CertificateNFT = await ethers.getContractFactory("CertificateNFT");
    certificateNFT = await CertificateNFT.deploy((await ethers.getSigners())[0].address);

    const AttendanceManager = await ethers.getContractFactory("AttendanceManager");
    attendanceManager = await AttendanceManager.deploy(
      await rewardToken.getAddress(),
      await certificateNFT.getAddress()
    );

    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await rewardToken.grantRole(MINTER_ROLE, await attendanceManager.getAddress());
    await certificateNFT.grantRole(MINTER_ROLE, await attendanceManager.getAddress());

    const TEACHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TEACHER_ROLE"));
    await attendanceManager.grantRole(TEACHER_ROLE, teacher.address);
  });

  it("should create class -> enroll -> attendance -> assignment completion -> certificate", async function () {
    const owner = (await ethers.getSigners())[0];
    const now = Math.floor(Date.now() / 1000);

    // Teacher creates class
    await attendanceManager
      .connect(teacher)
      .createClass("Blockchain 101", now, now + 86400 * 30);

    const classId = 0;

    // Enroll student
    await attendanceManager
      .connect(teacher)
      .enrollStudent(classId, student.address, "Student One");

    // Mark attendance (mints +1 token)
    await attendanceManager.connect(teacher).markAttendance(classId, [student.address]);

    // Create assignment
    const deadline = now + 86400 * 7;
    await attendanceManager
      .connect(teacher)
      .createAssignment(classId, "Homework 1", deadline);

    const assignmentId = 0;

    // Complete assignment (mints +5 token)
    await attendanceManager
      .connect(teacher)
      .recordAssignmentCompletion(assignmentId, student.address);

    // Issue certificate NFT
    const tx = await attendanceManager.connect(teacher).issueCertificate(classId, student.address);
    await tx.wait();

    // Attendance count should be 1
    expect(await attendanceManager.getStudentAttendanceCount(classId, student.address)).to.equal(1);

    // Reward tokens: +1 attendance +5 assignment = 6
    expect(await rewardToken.balanceOf(student.address)).to.equal(ethers.parseEther("6"));

    // Assignment completion history
    const completed = await attendanceManager.getCompletedAssignments(classId, student.address);
    expect(completed.map((x) => x.toString())).to.deep.equal(["0"]);

    // NFT certificate
    expect(await certificateNFT.balanceOf(student.address)).to.equal(1);

    const cert = await certificateNFT.getCertificate(0);
    expect(cert.classId).to.equal(0);
    expect(cert.className).to.equal("Blockchain 101");
    expect(cert.studentName).to.equal("Student One");
    expect(cert.attendanceCount).to.equal(1);
    expect(cert.totalSessions).to.equal(1);
    expect(await certificateNFT.attendanceRate(0)).to.equal(100);

    const uri = await certificateNFT.tokenURI(0);
    expect(uri.startsWith("data:application/json;base64,")).to.equal(true);

    const sessions = await attendanceManager.getClassSessions(classId);
    expect(sessions.length).to.equal(1);
    expect(sessions[0].sessionNumber).to.equal(1);

    const history = await attendanceManager.getAttendanceHistory(classId, student.address);
    expect(history[0].sessionNumber).to.equal(1);
  });
});

