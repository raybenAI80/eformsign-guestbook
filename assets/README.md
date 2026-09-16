# assets

키오스크 화면 헤더에 쓸 로고를 이 폴더에 둡니다.

- 파일 이름은 `logo.png` 를 권합니다(`config.js` 의 `logoUrl: 'assets/logo.png'`).
- 높이 160px 안팎, 배경이 투명한 PNG 가 가장 깔끔합니다.
- 설정 마법사(`setup.html`)에서 로고를 올리면 자동으로 줄여 설정 파일에 담고,
  줄인 뒤에도 40KB 를 넘으면 이 폴더의 `logo.png` 로 내보냅니다.
