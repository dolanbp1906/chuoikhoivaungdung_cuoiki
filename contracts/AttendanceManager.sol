// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./RewardToken.sol";
import "./CertificateNFT.sol";

contract AttendanceManager is AccessControl {
    bytes32 public constant TEACHER_ROLE = keccak256("TEACHER_ROLE");

    RewardToken public rewardToken;
    CertificateNFT public certificateNFT;

    uint256 public constant ATTENDANCE_REWARD = 1 * 10 ** 18;
    uint256 public constant ASSIGNMENT_REWARD = 5 * 10 ** 18;

    struct Class {
        uint256 id;
        string name;
        address teacher;
        uint256 startDate;
        uint256 endDate;
        bool active;
    }

    struct Student {
        address addr;
        string name;
        bool registered;
    }

    struct ClassSession {
        uint256 sessionNumber; // 1-based: Buoi 1, Buoi 2, ...
        uint256 timestamp;
    }

    struct AttendanceRecord {
        uint256 timestamp;
        bool present;
        uint256 sessionNumber;
    }

    struct Assignment {
        uint256 id;
        uint256 classId;
        string title;
        uint256 deadline;
    }

    uint256 public classCount;
    uint256 public assignmentCount;

    mapping(uint256 => Class) public classes;
    mapping(uint256 => address[]) public classStudents;
    mapping(address => Student) public students;

    // classId => sessions of the class
    mapping(uint256 => ClassSession[]) public classSessions;
    // classId => student => attendance records
    mapping(uint256 => mapping(address => AttendanceRecord[])) public attendanceRecords;
    // classId => student => attendance count
    mapping(uint256 => mapping(address => uint256)) public attendanceCount;
    // classId => total sessions marked
    mapping(uint256 => uint256) public totalSessions;

    // assignments
    mapping(uint256 => Assignment) public assignments;
    mapping(uint256 => uint256[]) public classAssignments;
    // assignmentId => student => completed
    mapping(uint256 => mapping(address => bool)) public assignmentCompleted;

    // classId => student => enrolled
    mapping(uint256 => mapping(address => bool)) public enrolled;
    // classId => student => certificate issued
    mapping(uint256 => mapping(address => bool)) public certificateIssued;

    event ClassCreated(uint256 indexed classId, string name, address teacher);
    event StudentEnrolled(uint256 indexed classId, address indexed student);
    event AttendanceMarked(
        uint256 indexed classId,
        address indexed student,
        uint256 timestamp,
        uint256 sessionNumber
    );
    event SessionCreated(uint256 indexed classId, uint256 sessionNumber, uint256 timestamp);
    event AssignmentCreated(uint256 indexed assignmentId, uint256 indexed classId, string title);
    event AssignmentCompleted(uint256 indexed assignmentId, address indexed student);
    event CertificateIssuedEvent(uint256 indexed classId, address indexed student, uint256 tokenId);

    constructor(address _rewardToken, address _certificateNFT) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(TEACHER_ROLE, msg.sender);
        rewardToken = RewardToken(_rewardToken);
        certificateNFT = CertificateNFT(_certificateNFT);
    }

    // --- Class Management ---

    function createClass(
        string calldata name,
        uint256 startDate,
        uint256 endDate
    ) external onlyRole(TEACHER_ROLE) returns (uint256) {
        require(endDate > startDate, "Invalid dates");
        uint256 classId = classCount++;
        classes[classId] = Class({
            id: classId,
            name: name,
            teacher: msg.sender,
            startDate: startDate,
            endDate: endDate,
            active: true
        });
        emit ClassCreated(classId, name, msg.sender);
        return classId;
    }

    function enrollStudent(
        uint256 classId,
        address studentAddr,
        string calldata studentName
    ) external onlyRole(TEACHER_ROLE) {
        require(classes[classId].active, "Class not active");
        require(!enrolled[classId][studentAddr], "Already enrolled");

        if (!students[studentAddr].registered) {
            students[studentAddr] = Student({
                addr: studentAddr,
                name: studentName,
                registered: true
            });
        }

        enrolled[classId][studentAddr] = true;
        classStudents[classId].push(studentAddr);
        emit StudentEnrolled(classId, studentAddr);
    }

    // --- Attendance ---

    function markAttendance(
        uint256 classId,
        address[] calldata studentAddrs
    ) external onlyRole(TEACHER_ROLE) {
        Class storage cls = classes[classId];
        require(cls.active, "Class not active");
        require(
            block.timestamp >= cls.startDate && block.timestamp <= cls.endDate,
            "Outside class period"
        );

        totalSessions[classId]++;
        uint256 sessionNumber = totalSessions[classId];
        classSessions[classId].push(
            ClassSession({sessionNumber: sessionNumber, timestamp: block.timestamp})
        );
        emit SessionCreated(classId, sessionNumber, block.timestamp);

        uint256 len = studentAddrs.length;
        for (uint256 i = 0; i < len; ) {
            address student = studentAddrs[i];
            require(enrolled[classId][student], "Student not enrolled");

            attendanceRecords[classId][student].push(
                AttendanceRecord({
                    timestamp: block.timestamp,
                    present: true,
                    sessionNumber: sessionNumber
                })
            );
            attendanceCount[classId][student]++;
            rewardToken.mint(student, ATTENDANCE_REWARD);

            emit AttendanceMarked(classId, student, block.timestamp, sessionNumber);
            unchecked {
                i++;
            }
        }
    }

    // --- Assignments ---

    function createAssignment(
        uint256 classId,
        string calldata title,
        uint256 deadline
    ) external onlyRole(TEACHER_ROLE) returns (uint256) {
        require(classes[classId].active, "Class not active");
        uint256 assignmentId = assignmentCount++;
        assignments[assignmentId] = Assignment({
            id: assignmentId,
            classId: classId,
            title: title,
            deadline: deadline
        });
        classAssignments[classId].push(assignmentId);
        emit AssignmentCreated(assignmentId, classId, title);
        return assignmentId;
    }

    function recordAssignmentCompletion(
        uint256 assignmentId,
        address student
    ) external onlyRole(TEACHER_ROLE) {
        Assignment storage a = assignments[assignmentId];
        require(enrolled[a.classId][student], "Student not enrolled");
        require(!assignmentCompleted[assignmentId][student], "Already completed");

        assignmentCompleted[assignmentId][student] = true;
        rewardToken.mint(student, ASSIGNMENT_REWARD);
        emit AssignmentCompleted(assignmentId, student);
    }

    // --- Certificate ---

    function issueCertificate(uint256 classId, address student) external onlyRole(TEACHER_ROLE) {
        require(enrolled[classId][student], "Student not enrolled");
        require(!certificateIssued[classId][student], "Certificate already issued");
        require(attendanceCount[classId][student] > 0, "No attendance");

        uint256[] storage assignmentIds = classAssignments[classId];
        uint256 len = assignmentIds.length;
        for (uint256 i = 0; i < len; ) {
            require(
                assignmentCompleted[assignmentIds[i]][student],
                "Assignments not completed"
            );
            unchecked {
                i++;
            }
        }

        certificateIssued[classId][student] = true;
        uint256 tokenId = certificateNFT.issueCertificate(
            student,
            classId,
            classes[classId].name,
            students[student].name,
            attendanceCount[classId][student],
            totalSessions[classId]
        );
        emit CertificateIssuedEvent(classId, student, tokenId);
    }

    // --- View Functions ---

    function getAttendanceHistory(
        uint256 classId,
        address student
    ) external view returns (AttendanceRecord[] memory) {
        return attendanceRecords[classId][student];
    }

    function getClassSessions(uint256 classId) external view returns (ClassSession[] memory) {
        return classSessions[classId];
    }

    function getClassStudents(uint256 classId) external view returns (address[] memory) {
        return classStudents[classId];
    }

    function getClassAssignments(uint256 classId) external view returns (uint256[] memory) {
        return classAssignments[classId];
    }

    function getCompletedAssignments(
        uint256 classId,
        address student
    ) external view returns (uint256[] memory completedAssignmentIds) {
        uint256[] storage ids = classAssignments[classId];

        uint256 count = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (assignmentCompleted[ids[i]][student]) {
                count++;
            }
        }

        completedAssignmentIds = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 aId = ids[i];
            if (assignmentCompleted[aId][student]) {
                completedAssignmentIds[idx] = aId;
                idx++;
            }
        }
    }

    function getStudentAttendanceCount(
        uint256 classId,
        address student
    ) external view returns (uint256) {
        return attendanceCount[classId][student];
    }
}
