import type { Metadata } from "next";
import Link from "next/link";
import notices from "./notices.json";
import projectLicense from "./project-license.json";
import styles from "./notice.module.css";

export const metadata: Metadata = {
  title: "저작권 및 라이선스",
  description: "Miroven의 저작권, 소스 코드와 외부 라이브러리 라이선스 안내입니다.",
  alternates: { canonical: "/notice" },
};

export default function NoticePage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.brand}>
          <Link href="/" aria-label="Miroven 메인 페이지로">← Miroven</Link>
        </p>
        <h1>저작권 및 라이선스</h1>
        <p>이 프로젝트와 함께 사용되는 오픈 소스 소프트웨어의 저작권 및 라이선스를 안내합니다.</p>
      </header>

      <section className={styles.section} aria-labelledby="project-title">
        <h2 id="project-title">Miroven</h2>
        <p>Copyright (C) 2026 Miroven Project</p>
        <p>GNU Affero General Public License v3.0 (AGPL-3.0)</p>
        <p>라이선스 조건에 따라 소스 코드를 사용, 수정 및 재배포할 수 있습니다. 이 소프트웨어는 어떠한 보증도 없이 제공됩니다. 자세한 조건은 아래 라이선스 원문을 확인해 주세요.</p>
        <a className={styles.source} href="https://github.com/mksdr/Miroven" target="_blank" rel="noopener noreferrer">GitHub에서 소스 코드 보기 ↗</a>
        <details className={styles.notice}>
          <summary>Miroven 라이선스 원문</summary>
          <pre lang="en">{projectLicense}</pre>
        </details>
      </section>

      <section className={styles.section} aria-labelledby="libraries-title">
        <h2 id="libraries-title">외부 라이브러리</h2>
        <p>직접·간접 의존성과 개발 도구를 포함한 {notices.length}개 패키지의 고지입니다. 각 소프트웨어의 권리는 해당 저작권자에게 있으며, 개별 라이선스가 적용됩니다.</p>
        <p>항목을 펼치면 저작권 고지와 라이선스 원문을 확인할 수 있습니다. Next.js의 내장 라이브러리, WebP 코덱 및 HEIC 변환에 사용되는 libheif·libde265의 고지도 함께 수록했습니다.</p>
        <div className={styles.list}>
          {notices.map((notice, index) => (
            <details className={styles.notice} key={`${notice.name}-${notice.version}-${index}`}>
              <summary>
                <span className={styles.packageName}>{notice.name} <span className={styles.version}>{notice.version}</span></span>
                <span className={styles.license}>{notice.license}{notice.development ? " · 개발 도구" : ""}</span>
              </summary>
              {notice.author && <p className={styles.author}>작성자: {notice.author}</p>}
              {notice.files.length ? notice.files.map((file) => (
                <div key={file.file} className={styles.original}>
                  <h3>{file.file}</h3>
                  <pre lang="en">{file.text}</pre>
                </div>
              )) : <p className={styles.author}>이 패키지의 배포본에는 별도 라이선스 원문 파일이 포함되어 있지 않습니다. 위 라이선스 표기는 패키지 메타데이터에 따른 것입니다.</p>}
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
