# Hướng dẫn demo

## 1. Demo trên Hardhat Local

### Bước 1: Chạy blockchain local
Trong thư mục gốc project:
```bash
npx hardhat node --hostname 127.0.0.1 --port 8545
```

### Bước 2: Chạy frontend
Mở terminal khác, trong thư mục `frontend`:
```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Mở trình duyệt tại:
`http://127.0.0.1:5173/`

### Bước 3: Thao tác trong UI
1. `Connect MetaMask`
2. (Lần đầu / mỗi lần reset chain) bấm `Deploy hợp đồng (Local)`
3. Tab `Teacher`:
   - `Create class`
   - `Enroll học viên`
   - `Điểm danh` (nhập địa chỉ học viên, tách bằng dấu phẩy hoặc xuống dòng)
   - `Bài tập`: `Create assignment`
   - `Ghi nhận hoàn thành`: `Record completion`
   - `Phát hành chứng nhận`: `Issue certificate (NFT)`
4. Tab `Student`:
   - Nhập `ClassId`
   - Bấm `Refresh` để xem token balance và history.

## 2. Deploy lên Sepolia (testnet)

1. Copy:
   - PowerShell: `Copy-Item .env.example .env`
   - hoặc CMD: `copy .env.example .env`
2. Điền:
   - `SEPOLIA_RPC_URL`
   - `PRIVATE_KEY`
3. Chạy deploy:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

## 3. Chạy test
```bash
npx hardhat test
```

