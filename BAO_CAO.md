# Báo cáo: Hệ thống điểm danh và ghi nhận hoạt động học tập (Blockchain)

> Bản nộp Word/PowerPoint nằm ở thư mục gốc đề án:
> - `BAO_CAO.docx`
> - `BAO_CAO_SLIDES.pptx` (bản slide đẹp — dùng file này để thuyết trình)
> - `BAO_CAO.pptx` (bản cũ, có thể bỏ)
> - `NHAT_KY_SU_DUNG_AI.docx`

## 1. Mô tả bài toán
Trong bối cảnh lớp học/khóa học yêu cầu minh chứng minh bạch về quá trình tham gia học tập, dữ liệu điểm danh và hoàn thành bài tập thường dễ bị thay đổi nếu lưu tập trung. Bài toán đặt ra là tạo cơ chế ghi nhận:
- Không thể tùy ý sửa lịch sử điểm danh/hoàn thành.
- Tra cứu được lịch sử học tập theo lớp và theo học viên.
- Cấp “chứng nhận hoàn thành” dưới dạng NFT để tăng tính xác thực.

## 2. Mục tiêu & phạm vi
- Tối thiểu: quản lý lớp, đăng ký học viên, điểm danh, ghi nhận hoàn thành bài tập, cấp chứng nhận NFT, tra cứu lịch sử.
- Phù hợp cho demo local/testnet: triển khai Hardhat + kết nối frontend qua MetaMask.

## 3. Kiến trúc tổng thể
```mermaid
flowchart TD
  UI[Frontend (React)] -->|ethers.js| Wallet[MetaMask]
  Wallet -->|JSON-RPC| Chain[Hardhat Local / Sepolia]
  Chain --> Contract1[AttendanceManager.sol]
  Chain --> Contract2[RewardToken.sol (ERC-20)]
  Chain --> Contract3[CertificateNFT.sol (ERC-721)]
```

## 4. Use case chính
1. Teacher tạo lớp học.
2. Teacher enroll học viên vào lớp.
3. Teacher đánh dấu điểm danh theo buổi (mints thưởng ERC-20).
4. Teacher tạo bài tập và ghi nhận hoàn thành (mints thêm thưởng).
5. Teacher phát hành chứng nhận (mint NFT) cho học viên đủ điều kiện.
6. Student tra cứu token balance và lịch sử điểm danh.

## 5. Thiết kế smart contract

### 5.1. Roles (AccessControl)
- `DEFAULT_ADMIN_ROLE`: quản trị hệ thống.
- `TEACHER_ROLE`: thao tác tạo lớp, enroll, điểm danh, tạo bài tập, cấp chứng nhận.
- `MINTER_ROLE`: quyền mint token thưởng/NFT chỉ được cấp cho `AttendanceManager`.

### 5.2. `AttendanceManager.sol` (contract chính)
**Dữ liệu chính**
- `Class`: `id, name, teacher, startDate, endDate, active`
- `Student`: `addr, name, registered`
- `AttendanceRecord`: `timestamp, present`
- `Assignment`: `id, classId, title, deadline`
- `Mappings`:
  - `classes[classId]`
  - `enrolled[classId][student]`
  - `attendanceRecords[classId][student][]`
  - `attendanceCount[classId][student]`
  - `classAssignments[classId][]`
  - `assignmentCompleted[assignmentId][student]`
  - `certificateIssued[classId][student]`

**Hành vi quan trọng**
- `markAttendance(classId, studentAddrs[])`
  - Yêu cầu: lớp `active`, thời gian nằm trong `[startDate, endDate]`.
  - Mỗi học viên được mint `ATTENDANCE_REWARD`.
- `recordAssignmentCompletion(assignmentId, student)`
  - Yêu cầu học viên đã enroll và chưa hoàn thành.
  - Mint `ASSIGNMENT_REWARD`.
- `issueCertificate(classId, student)`
  - Yêu cầu: học viên đã enroll, chưa từng cấp chứng nhận.
  - Yêu cầu thêm: học viên có `attendanceCount > 0`.
  - Nếu lớp có bài tập thì bắt buộc hoàn thành tất cả bài tập của lớp.

### 5.3. `RewardToken.sol` (ERC-20)
- Mint chỉ bởi `MINTER_ROLE` (cấp cho `AttendanceManager`).
- Token thưởng:
  - `+1 token` cho mỗi lần điểm danh
  - `+5 token` cho mỗi bài tập hoàn thành

### 5.4. `CertificateNFT.sol` (ERC-721)
- Mint chỉ bởi `MINTER_ROLE` (cấp cho `AttendanceManager`).
- Lưu trữ metadata on-chain dạng struct trong mapping `certificates[tokenId]`.

## 6. Thiết kế frontend (React + ethers.js + MetaMask)
Frontend nằm trong `attendance-blockchain/frontend`.
- `frontend/src/AppBlockchain.jsx`: giao diện demo.
- Dùng ABI + bytecode từ `frontend/src/artifacts/*.json` (copy từ Hardhat artifacts).
- Trường hợp demo:
  - Bấm Deploy -> Lưu địa chỉ hợp đồng vào `localStorage`
  - Teacher thao tác createClass/enroll/markAttendance/createAssignment/recordCompletion/issueCertificate
  - Student nhập `ClassId` -> Refresh để xem token balance + attendance history.

## 7. Kiểm thử
### 7.1. Unit tests
- Chạy: `npx hardhat test`
- Các test chính: `test/AttendanceManager.test.js`

### 7.2. E2E test luồng hoàn chỉnh
- File: `test/E2EAttendanceFlow.test.js`
- Luồng:
  `create class -> enroll -> mark attendance -> create assignment -> record completion -> issue certificate`

## 8. Phân tích rủi ro & bảo mật (tóm tắt)
1. **Centralization (quyền Teacher/Admin)**: Teacher có quyền thay đổi dữ liệu thông qua smart contract. Dữ liệu vẫn immutable nhưng quyền ghi nhận tập trung.
2. **Điểm danh theo timestamp**: có kiểm tra thời gian trong hợp đồng (`startDate/endDate`). Vẫn phụ thuộc block timestamp (tuy không quá nhạy trong bài demo).
3. **DoS/gas limit khi vòng lặp lớn**: `markAttendance` lặp qua danh sách student; nếu danh sách quá dài sẽ tốn gas.
4. **Minting quyền hạn**: đảm bảo `MINTER_ROLE` chỉ cấp cho `AttendanceManager` để tránh mint trái phép.
5. **Chứng nhận có điều kiện**: `issueCertificate` yêu cầu có attendance và hoàn thành bài tập (nếu tồn tại) nhằm giảm cấp chứng nhận “bừa”.

## 9. Nhật ký sử dụng công cụ AI

Nội dung nhật ký AI được nộp riêng trong file:

**`NHAT_KY_SU_DUNG_AI.docx`** (thư mục gốc đề án)

Tóm tắt: nhóm dùng **Cursor** hỗ trợ lập kế hoạch, smart contract, test, frontend, deploy Sepolia và soạn tài liệu; nhóm tự review, chạy thử và chịu trách nhiệm kết quả cuối cùng.

## 10. Hướng dẫn deploy testnet (Sepolia)
1. Tạo file `.env` từ `.env.example`:
   - `SEPOLIA_RPC_URL`
   - `PRIVATE_KEY`
2. Chạy:
   - `npx hardhat run scripts/deploy.js --network sepolia`

### Địa chỉ đã deploy (Sepolia)
| Contract | Address |
|----------|---------|
| RewardToken | `0x32c62BDFc15eF2d686f78b86491b284Ce91E2D67` |
| CertificateNFT | `0xEcF323e23F345eEaFaFe565C56082e82E366B02F` |
| AttendanceManager | `0x381bbF72B29bCf951d7e02d0cA43d5Db7922e2c8` |

- Deployer: `0xe4388388774C1a06A3013831f2024Df4b75F13D1`
- Repo: https://github.com/dolanbp1906/chuoikhoivaungdung_cuoiki

