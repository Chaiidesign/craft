#!/bin/zsh
# Page images of the sample exports, for visual inspection (PRD §12).
#   PDFs (ours):          pdftoppm → docs/documents/samples/pages/<name>-pdf-<n>.png
#   .docx via Pages:      Pages opens the file and exports a PDF → <name>-pages-<n>.png
#   .pptx via Keynote:    Keynote opens the file and exports a PDF → <name>-keynote-<n>.png
# Pages and Keynote show how Apple's apps render the files; Word and PowerPoint
# themselves are not available on this machine and remain unverified.
# Needs pdftoppm (poppler) and permission for the terminal to control Pages/Keynote.
set -euo pipefail
cd "$(dirname "$0")/../../docs/documents/samples"
mkdir -p pages apple
rm -f pages/*.png(N) apple/*.pdf(N)

export_once() { # app, input, output — the app name must be literal for its dictionary terms
  osascript -e "tell application \"$1\" to launch" -e 'delay 5' \
    -e 'with timeout of 180 seconds' -e "tell application \"$1\"" \
    -e "set d to open POSIX file \"$PWD/$2\"" -e 'delay 6' \
    -e "export d to POSIX file \"$PWD/$3\" as PDF" \
    -e 'close d saving no' -e 'end tell' -e 'end timeout'
}
# The apps sometimes time out on a cold open; close what is open and try once more.
export_with() {
  export_once "$@" || { osascript -e "tell application \"$1\" to close every document saving no"; sleep 5; export_once "$@"; }
}

for f in *.pdf; do pdftoppm -r 72 -png "$f" "pages/${f%.pdf}-pdf"; done
for f in *.docx; do export_with Pages "$f" "apple/${f%.docx}.pages.pdf"; pdftoppm -r 72 -png "apple/${f%.docx}.pages.pdf" "pages/${f%.docx}-pages"; done
for f in *.pptx; do export_with Keynote "$f" "apple/${f%.pptx}.keynote.pdf"; pdftoppm -r 72 -png "apple/${f%.pptx}.keynote.pdf" "pages/${f%.pptx}-keynote"; done
ls pages | wc -l
