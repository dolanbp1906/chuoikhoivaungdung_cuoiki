// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CertificateNFT is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 private _nextTokenId;

    struct Certificate {
        uint256 classId;
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
        string calldata studentName,
        uint256 attendanceCount,
        uint256 totalSessions
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _mint(student, tokenId);

        certificates[tokenId] = Certificate({
            classId: classId,
            studentName: studentName,
            completionDate: block.timestamp,
            attendanceCount: attendanceCount,
            totalSessions: totalSessions
        });

        emit CertificateIssued(tokenId, student, classId);
        return tokenId;
    }

    function getCertificate(uint256 tokenId) external view returns (Certificate memory) {
        require(tokenId < _nextTokenId, "Token does not exist");
        return certificates[tokenId];
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
