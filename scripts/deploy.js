const hre = require("hardhat");

/** Ví giáo viên dùng trên MetaMask (Sepolia). */
const TEACHER_ADDRESS = process.env.TEACHER_ADDRESS || "0x68478979b26a96d34Ac9b817977fd1D893bFfE1c";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);
  console.log("Teacher address:", TEACHER_ADDRESS);

  const RewardToken = await hre.ethers.getContractFactory("RewardToken");
  const rewardToken = await RewardToken.deploy(deployer.address);
  await rewardToken.waitForDeployment();
  const rewardTokenAddr = await rewardToken.getAddress();
  console.log("RewardToken deployed to:", rewardTokenAddr);

  const CertificateNFT = await hre.ethers.getContractFactory("CertificateNFT");
  const certificateNFT = await CertificateNFT.deploy(deployer.address);
  await certificateNFT.waitForDeployment();
  const certificateNFTAddr = await certificateNFT.getAddress();
  console.log("CertificateNFT deployed to:", certificateNFTAddr);

  const AttendanceManager = await hre.ethers.getContractFactory("AttendanceManager");
  const attendanceManager = await AttendanceManager.deploy(rewardTokenAddr, certificateNFTAddr);
  await attendanceManager.waitForDeployment();
  const attendanceManagerAddr = await attendanceManager.getAddress();
  console.log("AttendanceManager deployed to:", attendanceManagerAddr);

  const MINTER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("MINTER_ROLE"));
  const TEACHER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("TEACHER_ROLE"));

  let tx = await rewardToken.grantRole(MINTER_ROLE, attendanceManagerAddr);
  await tx.wait();
  tx = await certificateNFT.grantRole(MINTER_ROLE, attendanceManagerAddr);
  await tx.wait();
  console.log("MINTER_ROLE granted to AttendanceManager");

  if (TEACHER_ADDRESS.toLowerCase() !== deployer.address.toLowerCase()) {
    tx = await attendanceManager.grantRole(TEACHER_ROLE, TEACHER_ADDRESS);
    await tx.wait();
    console.log("TEACHER_ROLE granted to:", TEACHER_ADDRESS);
  }

  console.log("\n--- Deployment Summary ---");
  console.log("RewardToken:", rewardTokenAddr);
  console.log("CertificateNFT:", certificateNFTAddr);
  console.log("AttendanceManager:", attendanceManagerAddr);
  console.log("Teacher:", TEACHER_ADDRESS);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
