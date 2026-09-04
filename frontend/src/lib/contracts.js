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

/**
 * Bọc signer bằng NonceManager để tránh "Nonce too low" khi gửi nhiều tx liên tiếp
 * (đặc biệt với Wallet auto-sign trên Hardhat automine).
 */
export function withNonceManager(signer) {
  if (signer instanceof ethers.NonceManager) return signer;
  return new ethers.NonceManager(signer);
}

export async function deployAll(signer) {
  const managed = withNonceManager(signer);
  const admin = await managed.getAddress();

  const RewardTokenFactory = new ethers.ContractFactory(
    RewardTokenArtifact.abi,
    RewardTokenArtifact.bytecode,
    managed
  );
  const rewardToken = await RewardTokenFactory.deploy(admin);
  await rewardToken.waitForDeployment();
  await rewardToken.deploymentTransaction()?.wait(1);

  const CertificateNFTFactory = new ethers.ContractFactory(
    CertificateNFTArtifact.abi,
    CertificateNFTArtifact.bytecode,
    managed
  );
  const certificateNFT = await CertificateNFTFactory.deploy(admin);
  await certificateNFT.waitForDeployment();
  await certificateNFT.deploymentTransaction()?.wait(1);

  const rewardTokenAddr = await rewardToken.getAddress();
  const certificateNFTAddr = await certificateNFT.getAddress();

  const AttendanceManagerFactory = new ethers.ContractFactory(
    AttendanceManagerArtifact.abi,
    AttendanceManagerArtifact.bytecode,
    managed
  );
  const attendanceManager = await AttendanceManagerFactory.deploy(
    rewardTokenAddr,
    certificateNFTAddr
  );
  await attendanceManager.waitForDeployment();
  await attendanceManager.deploymentTransaction()?.wait(1);

  const attendanceManagerAddr = await attendanceManager.getAddress();

  let tx = await rewardToken.grantRole(MINTER_ROLE, attendanceManagerAddr);
  await tx.wait(1);
  tx = await certificateNFT.grantRole(MINTER_ROLE, attendanceManagerAddr);
  await tx.wait(1);
  tx = await attendanceManager.grantRole(TEACHER_ROLE, admin);
  await tx.wait(1);

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
        return parsed.args.tokenId?.toString() ?? null;
      }
    } catch {
      // ignore
    }
  }
  return null;
}
