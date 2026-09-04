// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract CertificateNFT is ERC721, AccessControl {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 private _nextTokenId;

    struct Certificate {
        uint256 classId;
        string className;
        string studentName;
        uint256 completionDate;
        uint256 attendanceCount;
        uint256 totalSessions;
    }

    mapping(uint256 => Certificate) public certificates;

    event CertificateIssued(uint256 indexed tokenId, address indexed student, uint256 classId);

    constructor(address admin) ERC721("Learning Certificate", "LCERT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function issueCertificate(
        address student,
        uint256 classId,
        string calldata className,
        string calldata studentName,
        uint256 attendanceCount,
        uint256 totalSessions
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _mint(student, tokenId);

        certificates[tokenId] = Certificate({
            classId: classId,
            className: className,
            studentName: studentName,
            completionDate: block.timestamp,
            attendanceCount: attendanceCount,
            totalSessions: totalSessions
        });

        emit CertificateIssued(tokenId, student, classId);
        return tokenId;
    }

    function getCertificate(uint256 tokenId) external view returns (Certificate memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return certificates[tokenId];
    }

    function attendanceRate(uint256 tokenId) public view returns (uint256) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        Certificate memory c = certificates[tokenId];
        if (c.totalSessions == 0) return 0;
        return (c.attendanceCount * 100) / c.totalSessions;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        Certificate memory c = certificates[tokenId];
        uint256 rate = c.totalSessions == 0 ? 0 : (c.attendanceCount * 100) / c.totalSessions;

        string memory name_ = string(
            abi.encodePacked("Chung nhan hoan thanh - ", c.studentName)
        );
        string memory description = string(
            abi.encodePacked(
                "Chung nhan hoan thanh lop ",
                c.className,
                ". Chuyen can ",
                rate.toString(),
                "% (",
                c.attendanceCount.toString(),
                "/",
                c.totalSessions.toString(),
                " buoi)."
            )
        );

        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '{"name":"',
                        name_,
                        '","description":"',
                        description,
                        '","attributes":[',
                        '{"trait_type":"Class","value":"',
                        c.className,
                        '"},',
                        '{"trait_type":"Student","value":"',
                        c.studentName,
                        '"},',
                        '{"trait_type":"ClassId","value":"',
                        c.classId.toString(),
                        '"},',
                        '{"trait_type":"Attendance Rate (%)","value":',
                        rate.toString(),
                        "},",
                        '{"trait_type":"Sessions Present","value":',
                        c.attendanceCount.toString(),
                        "},",
                        '{"trait_type":"Total Sessions","value":',
                        c.totalSessions.toString(),
                        "}",
                        "]}"
                    )
                )
            )
        );

        return string(abi.encodePacked("data:application/json;base64,", json));
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
