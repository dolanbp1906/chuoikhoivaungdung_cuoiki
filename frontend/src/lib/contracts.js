import { ethers } from "ethers";

import AttendanceManagerArtifact from "../artifacts/AttendanceManager.json";
import RewardTokenArtifact from "../artifacts/RewardToken.json";
import CertificateNFTArtifact from "../artifacts/CertificateNFT.json";

export const TEACHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TEACHER_ROLE"));
export const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

export function getChainIdFromProvider(provider) {
  return provider.getNetwork().then((n) => n.chainId);
}

export function createContractInstances(providerOrSigner, addresses) {
  if (!addresses) throw new Error("Missing contract addresses");

  const rewardToken = new ethers.Contract(
    addresses.rewardToken,
    RewardTokenArtifact.abi,
    providerOrSigner
  );
  const certificateNFT = new ethers.Contract(
    addresses.certificateNFT,
    CertificateNFTArtifact.abi,
    providerOrSigner
  );
  const attendanceManager = new ethers.Contract(
    addresses.attendanceManager,
    AttendanceManagerArtifact.abi,
    providerOrSigner
  );

  return { rewardToken, certificateNFT, attendanceManager };
}

export async function deployAll(signer) {
  const admin = await signer.getAddress();

  const RewardTokenFactory = new ethers.ContractFactory(
    RewardTokenArtifact.abi,
    RewardTokenArtifact.bytecode,
    signer
  );
  const rewardToken = await RewardTokenFactory.deploy(admin);
  await rewardToken.waitForDeployment();

  const CertificateNFTFactory = new ethers.ContractFactory(
    CertificateNFTArtifact.abi,
    CertificateNFTArtifact.bytecode,
    signer
  );
  const certificateNFT = await CertificateNFTFactory.deploy(admin);
  await certificateNFT.waitForDeployment();

  const AttendanceManagerFactory = new ethers.ContractFactory(
    AttendanceManagerArtifact.abi,
    AttendanceManagerArtifact.bytecode,
    signer
  );
  const attendanceManager = await AttendanceManagerFactory.deploy(
    await rewardToken.getAddress(),
    await certificateNFT.getAddress()
  );
  await attendanceManager.waitForDeployment();

  const attendanceManagerAddr = await attendanceManager.getAddress();

  // Connect Mint permissions
  const rewardTokenAddr = await rewardToken.getAddress();
  const certificateNFTAddr = await certificateNFT.getAddress();

  await rewardToken.grantRole(MINTER_ROLE, attendanceManagerAddr);
  await certificateNFT.grantRole(MINTER_ROLE, attendanceManagerAddr);

  // Extra safety: make sure admin is teacher (constructor already does msg.sender)
  await attendanceManager.grantRole(TEACHER_ROLE, admin);

  return {
    rewardToken: rewardTokenAddr,
    certificateNFT: certificateNFTAddr,
    attendanceManager: attendanceManagerAddr,
  };
}

export function parseCertificateIssuedTokenId(attendanceManagerInterface, receipt) {
  const targetEventName = "CertificateIssuedEvent";
  if (!receipt?.logs) return null;
  for (const log of receipt.logs) {
    try {
      const parsed = attendanceManagerInterface.parseLog(log);
      if (parsed?.name === targetEventName) {
        // event args: (classId, student, tokenId)
        return parsed.args.tokenId?.toString() ?? null;
      }
    } catch {
      // ignore logs not matching
    }
  }
  return null;
}

