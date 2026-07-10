/**
 * @file QR join code (PRD §3.1, V2-22). The `qrcode` package is bundled by
 * Vite — nothing is fetched from a QR web service at game time, because the
 * projector is exactly where a network hiccup is least welcome.
 *
 * Rendered light-on-dark inverted (dark modules on a white quiet zone) rather
 * than themed to the night canvas: phone cameras want contrast and a real
 * quiet zone, and a #FFE600-on-#0B0C10 QR scans badly across a room.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * The URL a player's camera should land on. Absolute, because it leaves this
 * device. Carries `?driver=mock` through when offline (V2-21) so a scanned
 * phone doesn't silently try to reach Firebase.
 * @param {string} roomCode
 * @param {'play'|'display'} [route='play']
 * @returns {string}
 */
export function joinUrl(roomCode, route = 'play') {
  const url = new URL(`/${route}`, window.location.origin);
  url.searchParams.set('room', roomCode);
  const driver = new URLSearchParams(window.location.search).get('driver');
  if (driver) url.searchParams.set('driver', driver);
  return url.toString();
}

/**
 * @param {Object} props
 * @param {string} props.value - the URL to encode.
 * @param {number} [props.size=192]
 */
export function QrCode({ value, size = 192 }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2, // 2x for retina; CSS scales it back down
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0B0C10', light: '#FFFFFF' },
    })
      .then((url) => !cancelled && setDataUrl(url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  // A QR that won't render must not blank the lobby — the room code beside it
  // is the real join mechanism; the QR is the shortcut.
  if (failed) return null;

  return (
    <img
      src={dataUrl ?? undefined}
      alt={`QR code to join at ${value}`}
      width={size}
      height={size}
      className="rounded-xl bg-white"
      style={{ width: size, height: size, visibility: dataUrl ? 'visible' : 'hidden' }}
    />
  );
}
