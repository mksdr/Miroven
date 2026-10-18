import type { Metadata } from "next";
import { GuideContent } from "./GuideContent";

export const metadata: Metadata = {
  title: "사용 안내",
  description: "Miroven에서 첫 기록 남기기, 검색, 동기화와 복구 코드, 암호화 백업 방법을 알아보세요.",
  alternates: { canonical: "/guide" },
};

export default function GuidePage() {
  return <GuideContent />;
}
