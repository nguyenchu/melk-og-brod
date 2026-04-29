#!/usr/bin/env bash
# Tar App Store-skjermbilder og setter dem inn i iPhone-ramme.
# Krav: Expo-appen må kjøre i simulatoren (npx expo start --ios).
#
# Bruk: bash scripts/take_screenshots.sh

set -euo pipefail

OUT="screenshots"
PYTHON="${PYTHON:-$(dirname "$0")/../.venv/bin/python}"
mkdir -p "$OUT"

echo "Sjekker at en simulator kjører..."
if ! xcrun simctl list devices | grep -q "(Booted)"; then
  echo "Feil: ingen iOS Simulator er startet. Kjør 'npx expo start --ios' først."
  exit 1
fi

snapshot() {
  local name="$1"
  local prompt="$2"
  echo ""
  echo "📱 $prompt"
  read -r -p "   Trykk Enter når skjermen er klar..."
  xcrun simctl io booted screenshot "${OUT}/${name}.png"
  echo "   Skjermbilde tatt — setter på ramme..."
  "$PYTHON" "$(dirname "$0")/frame_screenshot.py" "${OUT}/${name}.png"
}

snapshot "01_tilbud"      "Naviger til Tilbud-fanen og vent til listen er lastet."
snapshot "02_sok"         "Naviger til Handleliste-fanen, trykk i søkefeltet og skriv inn noe (f.eks. 'ost') — vent til resultater med tilbudsmerker vises."
snapshot "03_handleliste" "Legg noen varer i handlelisten og gå til Handleliste-fanen."

echo ""
echo "Ferdig!"
echo "  Råbilder:   ${OUT}/*.png"
echo "  Med ramme:  ${OUT}/*_framed.jpg"
