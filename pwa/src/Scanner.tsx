import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { t } from './lib/i18n';
export default function Scanner({
  onCode,
  onCancel,
}: {
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false,
      stream: MediaStream | undefined,
      timer = 0;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.current!.srcObject = s;
        await video.current!.play();
        const canvas = document.createElement('canvas'),
          ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const scan = () => {
          if (stopped) return;
          const v = video.current!;
          if (v.videoWidth) {
            canvas.width = Math.min(v.videoWidth, 960);
            canvas.height = (v.videoHeight * canvas.width) / v.videoWidth;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(pixels.data, pixels.width, pixels.height);
            if (qr?.data.startsWith('tandem-pair:')) {
              onCode(qr.data);
              return;
            }
          }
          timer = window.setTimeout(scan, 150);
        };
        scan();
      })
      .catch(() => setError(t('cameraError')));
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <section className="card">
      <video ref={video} playsInline muted />
      <p role="alert">{error}</p>
      <button onClick={onCancel}>{t('cancel')}</button>
    </section>
  );
}
