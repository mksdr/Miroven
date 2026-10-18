export const GUIDE = {
  ko: {
    title: "Miroven 사용 안내",
    intro: "첫 기록부터 안전한 보관까지, 필요한 내용을 차근차근 확인하세요.",
    back: "저널로 이동",
    contents: "이 페이지에서",
    start: "기록하러 가기",
    sections: [
      {
        id: "about", title: "1. 나만의 기록을 남기는 공간",
        paragraphs: ["Miroven은 글과 사진으로 일상을 남기는 개인 저널입니다. 타임라인과 프로필은 내 기록을 위한 것이며, 다른 사용자에게 글을 공개하거나 팔로워와 소통하는 기능은 없습니다.", "로그인 없이 바로 기록할 수 있습니다. 본문과 사진은 이 기기에서 암호화되어 브라우저에 저장됩니다. 공용 기기에서는 계정 설정에서 PIN을 설정하고, 사용 후 금고를 잠가 주세요. 로그인과 기기 잠금은 서로 다른 기능입니다."],
      },
      {
        id: "write", title: "2. 첫 기록 남기기",
        paragraphs: ["짧은 생각이나 사진 한 장이면 충분합니다. 예를 들어 ‘오늘은 산책하면서 마음이 조금 가벼워졌다’처럼 적어 보세요."],
        steps: ["저널 화면의 ‘무슨 생각을 하고 있나요?’ 작성란에 내용을 적습니다.", "사진을 남기려면 ‘사진’을 눌러 첨부합니다. 사진만으로도 기록할 수 있습니다.", "‘기록’을 누른 뒤 타임라인에 글이 나타나는지 확인합니다.", "저장한 기록의 ‘기록 수정’ 버튼으로 내용을 바꿀 수 있습니다. 삭제할 때는 해당 기록의 ‘기록 삭제’를 선택하고 확인합니다."],
      },
      {
        id: "find", title: "3. 기록 다시 찾기와 화면 설정",
        paragraphs: ["‘검색’에서 본문, 날짜, #해시태그, 한글 초성으로 기록을 찾을 수 있습니다. 날짜 필터에서 오늘, 이번 주 또는 원하는 기간을 선택해 범위를 좁히세요. 글을 쓸 때 #산책처럼 태그를 남기면 나중에 모아 보기 편합니다.", "자주 보는 기록은 최대 3개까지 고정할 수 있습니다. 프로필 이미지나 이름을 누르면 나의 표시 이름과 사진을 바꿀 수 있으며, 공개 프로필이 만들어지는 것은 아닙니다.", "‘표시 설정’에서 언어, 테마, 글자 크기를 바꿀 수 있습니다. 모바일에서는 화면 아래 메뉴를 사용하세요. 이 안내 문서는 계정 설정의 ‘Miroven 및 정책’에서 다시 열 수 있습니다."],
      },
      {
        id: "storage", title: "4. 기록은 어디에 보관되나요?",
        paragraphs: ["기본 저장 위치는 지금 사용하는 기기의 브라우저입니다. 같은 기기라도 브라우저, 브라우저 프로필, 사이트 주소가 달라지면 기존 기록이 자동으로 나타나지 않을 수 있습니다. 브라우저 데이터 삭제나 기기 분실로 로컬 기록을 잃을 수 있습니다.", "기록을 오래 보관하려면 아래 세 가지의 역할을 구분해 주세요. 복구 코드만으로 기록 자체를 되살릴 수는 없습니다."],
        terms: [
          ["기기 내 저장", "로그인 없이 사용할 수 있는 기본 저장 방식입니다. 이 브라우저의 데이터를 지우면 기록과 잠금에 필요한 정보도 사라질 수 있습니다."],
          ["동기화", "서버 연결이 제공되는 환경에서 계정 로그인과 복구 코드 설정을 마치면 암호화한 기록을 다른 기기로 이어갈 수 있습니다. 로그인만으로 동기화 준비가 끝나지는 않습니다. 오프라인에서 쓴 기록은 연결 후 동기화 완료를 확인하세요."],
          ["암호화 백업", "계정 화면에서 별도로 내려받는 파일입니다. 현재 기기의 기록을 담고 있으며, 복원하려면 같은 금고의 복구 코드도 필요합니다. 중요한 변경 후 새 백업을 만들어 주세요."],
        ],
      },
      {
        id: "restore", title: "5. 다른 기기에서 이어 쓰기와 복구",
        paragraphs: ["복구 코드는 암호화한 금고를 여는 데 필요합니다. 이메일 로그인 코드는 계정에 로그인하는 용도이고, PIN은 이 기기의 금고를 잠그는 용도입니다. 서로 대신할 수 없습니다.", "복구 코드를 만들 때 한 번 표시되는 코드를 비밀번호 관리 앱이나 안전한 오프라인 장소에 보관하세요. 백업 파일과 코드는 서로 다른 곳에 보관하는 것이 좋습니다."],
        steps: ["서버 동기화를 사용할 경우: 원래 기기에서 ‘계정’의 이메일 로그인과 저널 화면의 ‘복구 코드 만들기’를 완료하고, 동기화 완료 상태를 확인합니다. 서버 연결이 없는 환경에서는 파일 백업으로 옮깁니다.", "새 기기에서 동기화된 기록을 받을 경우: 같은 서버의 같은 계정으로 로그인한 뒤 기존 복구 코드를 입력해 금고를 복구합니다. 이전 기기에서 아직 전송하지 못한 기록은 내려받을 수 없습니다.", "파일로 옮길 경우: 원래 기기에서 복구 코드를 만든 뒤 ‘계정’ → ‘암호화 백업 내려받기’를 선택합니다.", "백업을 복원할 경우: 기존 기록이나 복구 설정이 없는 빈 금고에서 ‘계정’을 열고, 백업 파일과 같은 금고의 복구 코드를 사용해 ‘암호화 백업 가져오기’를 진행합니다. 복원 결과를 확인할 때까지 원래 기기와 파일을 보관하세요."],
      },
    ],
    faqTitle: "6. 자주 묻는 질문",
    faqs: [
      ["다른 사람에게 내 기록이 보이나요?", "다른 사용자에게 기록을 공개하는 기능은 없습니다. 본문과 사진은 기기에서 암호화되어 서버로 전송됩니다. 다만 서버 연결 시 이메일, 접속·변경 시각, 암호문 크기 같은 메타데이터는 서버에서 확인할 수 있습니다. 잠금이 풀린 내 기기에 접근할 수 있는 사람은 화면의 기록을 볼 수 있으니 PIN과 기기 잠금을 함께 사용하세요."],
      ["로그아웃하면 기록이 지워지나요?", "로그아웃은 로그인 세션을 종료하며 이 브라우저의 기록을 지우지 않습니다. ‘이 기기의 로컬 금고 초기화’와 ‘계정 및 모든 데이터 삭제’는 별도의 삭제 작업입니다."],
      ["브라우저 데이터를 지워도 되나요?", "먼저 동기화 완료 여부와 복구 코드 보관 여부를 확인하고, 중요한 기록은 암호화 백업 파일도 내려받으세요. 동기화되지 않은 기록은 서버에서 복구할 수 없습니다. 임시·비공개 브라우징은 종료 시 저장 데이터가 사라질 수 있어 장기 보관용으로 사용하지 않는 것이 좋습니다."],
      ["복구 코드를 잃어버렸어요. 이메일이나 PIN으로 대신할 수 있나요?", "이메일 로그인과 PIN은 복구 코드를 대신하지 못합니다. 기존 기기에서 기록을 열 수 있다면 브라우저 데이터를 지우거나 금고를 초기화하지 말고 원본을 보존하세요. 새 기기에서 암호화된 기록이나 백업을 열려면 같은 금고의 복구 코드가 필요합니다."],
      ["복구 코드만 있으면 기록을 복원할 수 있나요?", "복구 코드와 함께 서버에 동기화된 암호문 또는 암호화 백업 파일이 필요합니다. 코드는 금고를 여는 열쇠이며 기록 내용 자체를 담고 있지 않습니다."],
      ["계정에 로그인할 수 있는 곳이 없어요.", "서버 연결이 설정되지 않은 환경에서는 로컬 전용으로 동작합니다. 로그인 없이 기록하고, 복구 코드와 암호화 백업 파일을 보관해 다른 기기로 옮길 수 있습니다."],
    ],
  },
  en: {
    title: "Miroven user guide",
    intro: "From your first entry to keeping it safe, take things one step at a time.",
    back: "Go to journal", contents: "On this page", start: "Start writing",
    sections: [
      { id: "about", title: "1. A space for your own thoughts", paragraphs: ["Miroven is a personal journal for words and photos. The timeline and profile belong to your private journal; there is no feature for publishing entries to other users or interacting with followers.", "Start without signing in. Text and photos are encrypted on this device and stored in the browser. On a shared device, set a PIN in Account and lock your vault after use. Signing in and locking this device serve different purposes."] },
      { id: "write", title: "2. Write your first entry", paragraphs: ["A few words or a photo is enough. Try: ‘A walk helped me clear my head today.’"], steps: ["Type in the ‘What’s on your mind?’ box on the Journal screen.", "Choose Photo to attach an image. You can also save a photo without text.", "Choose Save and check that the entry appears in your timeline.", "Use Edit entry to change a saved entry, or Delete entry and confirm to remove it."] },
      { id: "find", title: "3. Find entries and make yourself at home", paragraphs: ["Use Search to find text, dates, #hashtags or Korean initial consonants (Choseong). Narrow results with date filters such as Today, This week or a custom range. Include tags like #walk in entries to find related thoughts later.", "Pin up to three entries you revisit often. Select your profile image or name to edit your display name and photo. This does not create a public profile.", "Display settings lets you change language, theme and text size. On mobile, use the menu at the bottom. You can reopen this guide from Miroven & Policies in Account settings."] },
      { id: "storage", title: "4. Where are entries kept?", paragraphs: ["By default, entries live in the browser on this device. A different browser, browser profile or site address may have separate storage, even on the same device. Clearing browser data or losing your device can mean losing local entries.", "These three features have different roles. A recovery code alone cannot bring back the entry data."], terms: [
        ["Local storage", "The default, with no sign-in required. Clearing this browser’s data may remove entries and the information needed to unlock them."],
        ["Sync", "Where a server connection is available, sign in and set up a recovery code to continue with encrypted entries on another device. Signing in alone does not finish sync setup. After writing offline, reconnect and check that sync completes."],
        ["Encrypted backup", "A separate file downloaded from Account, containing entries on this device. Restoring it also requires the recovery code for the same vault. Make a fresh backup after important changes."],
      ] },
      { id: "restore", title: "5. Continue on another device or restore a backup", paragraphs: ["Your recovery code opens your encrypted vault. An email sign-in code authenticates your account; a PIN locks the vault on this device. They cannot replace one another.", "When you create a recovery code, it is shown once. Store it in a password manager or a safe offline location. Keep the backup file and code separately."], steps: ["To use server sync: on your original device, sign in through Account, choose Create recovery code on the Journal screen, and check that sync completes. Without a server connection, use a file backup instead.", "To retrieve synced entries on a new device: sign in to the same account on the same server and enter your existing recovery code. Entries that never finished uploading are not available from the server.", "To move entries in a file: create a recovery code on the original device, then select Account → Download encrypted backup.", "To restore a backup: open Account in an empty vault with no existing entries or recovery setup. Use Import encrypted backup with the file and the recovery code for that vault. Keep the original device and file until you have checked the restored entries."] },
    ],
    faqTitle: "6. Frequently asked questions",
    faqs: [
      ["Can other people see my entries?", "There is no feature for publishing entries to other users. Text and photos are encrypted on your device before transmission. When using a server, metadata such as email, access and modification times, and ciphertext sizes is visible to the server. Someone with access to your unlocked device can read what is on screen; use a PIN and device lock."],
      ["Does signing out delete entries?", "Signing out ends the sign-in session but keeps entries in this browser. Reset local vault on this device and Delete account & all data are separate deletion actions."],
      ["Can I clear my browser data?", "First check that sync is complete and your recovery code is stored safely. Download an encrypted backup of important entries too. Entries that were not synced cannot be restored from the server. Private browsing may discard data when closed, so avoid using it for long-term storage."],
      ["I lost my recovery code. Can email or a PIN replace it?", "Email sign-in and a PIN cannot replace your recovery code. If an existing device still opens your entries, preserve it; do not clear browser data or reset its vault. Opening encrypted entries or a backup on a new device requires the recovery code for the same vault."],
      ["Is a recovery code enough to restore entries?", "You also need ciphertext synced to the server or an encrypted backup file. The code is the key to the vault, not a copy of its contents."],
      ["Why can’t I sign in?", "An installation without a configured server runs locally. You can write without signing in and move entries using a recovery code and encrypted backup file."],
    ],
  },
};
