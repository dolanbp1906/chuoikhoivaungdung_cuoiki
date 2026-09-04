# Báo cáo: Hệ thống điểm danh và ghi nhận hoạt động học tập (Blockchain)

> **File Word đầy đủ (trang bìa + ~20–30 trang):** `BAO_CAO.docx` (thư mục gốc đề án)
>
> Cấu trúc và trang bìa theo mẫu báo cáo Phân hiệu Trường ĐH Thủy Lợi (cùng học viên).
>
> Các file liên quan:
> - `BAO_CAO_SLIDES.pptx` — slide thuyết trình
> - `NHAT_KY_SU_DUNG_AI.docx` — nhật ký AI
> - `KICH_BAN_THUYET_TRINH.docx` — kịch bản thuyết trình

## Trang bìa (tóm tắt)
- Phân hiệu Trường Đại học Thủy Lợi
- Đề tài: **Hệ thống điểm danh và ghi nhận hoạt động học tập trên Blockchain**
- Học viên: Đỗ Thị Lan — MSSV 2582003122 — Lớp 33CNTT21-PH
- GVHD: TS. Hoàng Văn Quý
- TP. Hồ Chí Minh, tháng 9 năm 2026

## Cấu trúc báo cáo Word

1. Mục lục, lời cam đoan, danh mục hình/bảng, từ viết tắt  
2. **Chương 1 — Lời mở đầu:** bối cảnh, cấp thiết, mục đích, phương pháp & phạm vi, câu hỏi, tổng quan tài liệu  
3. **Chương 2 — Tổng quan & lý thuyết:** bài toán điểm danh on-chain, Blockchain/Ethereum, Solidity, ERC-20/721, AccessControl, MetaMask  
4. **Chương 3 — Phân tích & thiết kế:** use case, kiến trúc, smart contract, frontend, quy trình triển khai  
5. **Chương 4 — Thực nghiệm & đánh giá:** môi trường, unit/E2E test, demo local + Sepolia, rủi ro bảo mật, tính ứng dụng  
6. **Chương 5 — Kết luận:** kết luận, hạn chế, hướng phát triển  
7. Tài liệu tham khảo & Phụ lục (demo, nhật ký AI, stack, bổ sung lý thuyết)

## Kết quả kỹ thuật (tóm tắt)

| Hạng mục | Nội dung |
|----------|----------|
| Stack | Solidity + Hardhat + React/Vite + ethers.js + MetaMask |
| Contracts | AttendanceManager, RewardToken (ERC-20), CertificateNFT (ERC-721) |
| Test | ~10 tests passing (unit + E2E) |
| Sepolia AttendanceManager | `0x381bbF72B29bCf951d7e02d0cA43d5Db7922e2c8` |
| Repo | https://github.com/dolanbp1906/chuoikhoivaungdung_cuoiki |

Chi tiết đầy đủ xem trong `BAO_CAO.docx`.
