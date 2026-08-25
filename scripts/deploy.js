const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

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
  await rewardToken.grantRole(MINTER_ROLE, attendanceManagerAddr);
  await certificateNFT.grantRole(MINTER_ROLE, attendanceManagerAddr);
  console.log("MINTER_ROLE granted to AttendanceManager");

  console.log("\n--- Deployment Summary ---");
  console.log("RewardToken:", rewardTokenAddr);
  console.log("CertificateNFT:", certificateNFTAddr);
  console.log("AttendanceManager:", attendanceManagerAddr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
