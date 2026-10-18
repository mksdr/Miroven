import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404: 페이지를 찾을 수 없습니다",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div className="not-found-shell">
      <div className="not-found-card">
        <h1 className="not-found-code">404</h1>
        <h2 className="not-found-title">페이지를 찾을 수 없습니다</h2>
        <p className="not-found-desc">
          요청하신 페이지가 존재하지 않거나 이동되었습니다.
        </p>
        <Link href="/" className="not-found-link">
          Miroven 홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
