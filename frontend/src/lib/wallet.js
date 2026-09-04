import { ethers } from "ethers";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";
export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

/**
 * Contract phiên bản mới trên Sepolia (metadata NFT + điểm danh theo buổi).
 * Giáo viên: 0x68478979b26a96d34Ac9b817977fd1D893bFfE1c
 */
export const SEPOLIA_CONTRACTS = {
  attendanceManager: "0x979d3c0b635cd629244f906acC922AAa644fd575",
  rewardToken: "0xB8835142CCd3C6D138b4901513efe5b277546c63",
  certificateNFT: "0x7Eafc2a95102f23fefc6166c8B6994a39E52d26A",
};

export function explorerAddressUrl(address) {
  return `${SEPOLIA_EXPLORER}/address/${address}`;
}

export function explorerTxUrl(txHash) {
  return `${SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export async function ensureSepolia() {
  if (!window.ethereum) {
    throw new Error("Chưa thấy MetaMask. Hãy cài tiện ích MetaMask.");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (e) {
    if (e?.code === 4902 || e?.error?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_CHAIN_ID_HEX,
            chainName: "Sepolia",
            nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: [SEPOLIA_EXPLORER],
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

export async function connectMetaMaskSepolia() {
  if (!window.ethereum) {
    throw new Error("Chưa thấy MetaMask. Hãy cài tiện ích MetaMask.");
  }

  await ensureSepolia();

  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);

  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Vui lòng chuyển MetaMask sang mạng Sepolia.");
  }

  return {
    provider,
    signer,
    address: await signer.getAddress(),
    chainId,
    autoSign: false,
  };
}

export async function getConnectedMetaMask() {
  if (!window.ethereum) return null;
  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_accounts", []);
  if (!accounts?.length) return null;
  const signer = await provider.getSigner();
  const net = await provider.getNetwork();
  return {
    provider,
    signer,
    address: await signer.getAddress(),
    chainId: Number(net.chainId),
    autoSign: false,
  };
}
