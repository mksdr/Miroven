"use client";

import Link from "next/link";
import { useAppearance } from "../hooks/useAppearance";
import { GUIDE } from "./guide-copy";
import styles from "./guide.module.css";

export function GuideContent() {
  const { language, setLanguage } = useAppearance();
  const t = GUIDE[language];
  return (
    <main className={styles.page} lang={language} id="top">
      <header className={styles.header}>
        <div className={styles.top}>
          <Link href="/">← {t.back}</Link>
          <div className={styles.languages} role="group" aria-label={language === "ko" ? "문서 언어" : "Guide language"}>
            <button type="button" aria-pressed={language === "ko"} onClick={() => setLanguage("ko")}>한국어</button>
            <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
          </div>
        </div>
        <p className={styles.brand}>Miroven</p>
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </header>
      <nav className={styles.contents} aria-label={t.contents}>
        <strong>{t.contents}</strong>
        {t.sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}
        <a href="#faq">{t.faqTitle}</a>
      </nav>
      {t.sections.map(section => (
        <section key={section.id} id={section.id} className={styles.section} aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          {"steps" in section && section.steps ? <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol> : null}
          {"terms" in section && section.terms ? <dl>{section.terms.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl> : null}
        </section>
      ))}
      <section id="faq" className={styles.section} aria-labelledby="faq-title">
        <h2 id="faq-title">{t.faqTitle}</h2>
        {t.faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}
      </section>
      <footer className={styles.footer}><Link href="/">{t.start} →</Link><a href="#top">{language === "ko" ? "맨 위로" : "Back to top"} ↑</a></footer>
    </main>
  );
}
