const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AttendanceManager", function () {
  let rewardToken, certificateNFT, attendanceManager;
  let owner, teacher, student1, student2;

  beforeEach(async function () {
    [owner, teacher, student1, student2] = await ethers.getSigners();

    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy(owner.address);

    const CertificateNFT = await ethers.getContractFactory("CertificateNFT");
    certificateNFT = await CertificateNFT.deploy(owner.address);

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

  describe("Class Management", function () {
    it("should create a class", async function () {
      const now = Math.floor(Date.now() / 1000);
      await attendanceManager.connect(teacher).createClass("Blockchain 101", now, now + 86400 * 30);
      const cls = await attendanceManager.classes(0);
      expect(cls.name).to.equal("Blockchain 101");
      expect(cls.teacher).to.equal(teacher.address);
      expect(cls.active).to.be.true;
    });

    it("should enroll a student", async function () {
      const now = Math.floor(Date.now() / 1000);
      await attendanceManager.connect(teacher).createClass("Blockchain 101", now, now + 86400 * 30);
      await attendanceManager.connect(teacher).enrollStudent(0, student1.address, "Student One");

      const student = await attendanceManager.students(student1.address);
      expect(student.name).to.equal("Student One");
      expect(student.registered).to.be.true;
      expect(await attendanceManager.enrolled(0, student1.address)).to.be.true;
    });

    it("should not enroll same student twice", async function () {
      const now = Math.floor(Date.now() / 1000);
      await attendanceManager.connect(teacher).createClass("Blockchain 101", now, now + 86400 * 30);
      await attendanceManager.connect(teacher).enrollStudent(0, student1.address, "Student One");
      await expect(
        attendanceManager.connect(teacher).enrollStudent(0, student1.address, "Student One")
      ).to.be.revertedWith("Already enrolled");
    });
  });

  describe("Attendance", function () {
    beforeEach(async function () {
      const now = Math.floor(Date.now() / 1000);
      await attendanceManager.connect(teacher).createClass("Blockchain 101", now, now + 86400 * 30);
      await attendanceManager.connect(teacher).enrollStudent(0, student1.address, "Student One");
      await attendanceManager.connect(teacher).enrollStudent(0, student2.address, "Student Two");
    });

    it("should mark attendance and reward tokens", async function () {
      await attendanceManager.connect(teacher).markAttendance(0, [student1.address, student2.address]);

      expect(await attendanceManager.attendanceCount(0, student1.address)).to.equal(1);
      expect(await attendanceManager.attendanceCount(0, student2.address)).to.equal(1);
      expect(await rewardToken.balanceOf(student1.address)).to.equal(ethers.parseEther("1"));
    });

    it("should track total sessions", async function () {
      await attendanceManager.connect(teacher).markAttendance(0, [student1.address]);
      await attendanceManager.connect(teacher).markAttendance(0, [student1.address, student2.address]);
      expect(await attendanceManager.totalSessions(0)).to.equal(2);
      expect(await attendanceManager.attendanceCount(0, student1.address)).to.equal(2);
    });
  });

  describe("Assignments", function () {
    beforeEach(async function () {
      const now = Math.floor(Date.now() / 1000);
      await attendanceManager.connect(teacher).createClass("Blockchain 101", now, now + 86400 * 30);
      await attendanceManager.connect(teacher).enrollStudent(0, student1.address, "Student One");
    });

    it("should create assignment and record completion", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 7;
      await attendanceManager.connect(teacher).createAssignment(0, "Homework 1", deadline);

      await attendanceManager.connect(teacher).recordAssignmentCompletion(0, student1.address);
      expect(await attendanceManager.assignmentCompleted(0, student1.address)).to.be.true;
      expect(await rewardToken.balanceOf(student1.address)).to.equal(ethers.parseEther("5"));
    });

    it("should not allow double completion", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 7;
      await attendanceManager.connect(teacher).createAssignment(0, "Homework 1", deadline);
      await attendanceManager.connect(teacher).recordAssignmentCompletion(0, student1.address);
      await expect(
        attendanceManager.connect(teacher).recordAssignmentCompletion(0, student1.address)
      ).to.be.revertedWith("Already completed");
    });
  });

  describe("Certificate", function () {
    beforeEach(async function () {
      const now = Math.floor(Date.now() / 1000);
      await attendanceManager.connect(teacher).createClass("Blockchain 101", now, now + 86400 * 30);
      await attendanceManager.connect(teacher).enrollStudent(0, student1.address, "Student One");
      await attendanceManager.connect(teacher).markAttendance(0, [student1.address]);
    });

    it("should issue certificate NFT", async function () {
      await attendanceManager.connect(teacher).issueCertificate(0, student1.address);
      expect(await certificateNFT.balanceOf(student1.address)).to.equal(1);

      const cert = await certificateNFT.getCertificate(0);
      expect(cert.classId).to.equal(0);
      expect(cert.studentName).to.equal("Student One");
      expect(cert.attendanceCount).to.equal(1);
    });

    it("should not issue certificate twice", async function () {
      await attendanceManager.connect(teacher).issueCertificate(0, student1.address);
      await expect(
        attendanceManager.connect(teacher).issueCertificate(0, student1.address)
      ).to.be.revertedWith("Certificate already issued");
    });
  });
});
