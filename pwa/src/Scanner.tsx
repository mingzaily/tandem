import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { CameraOff, ClipboardPaste, RotateCcw } from 'lucide-react';
import { Sheet } from './Sheet';
import { canRetry, cameraProblem, type CameraProblem } from './lib/camera';
import { t } from './lib/i18n';

const PROBLEM_TEXT: Record<CameraProblem, { title: Parameters<typeof t>[0]; detail: Parameters<typeof t>[0] }> = {
  insecure: { title: 'cameraUnavailable', detail: 'cameraInsecure' },
  denied: { title: 'cameraDeniedTitle', detail: 'cameraDenied' },
  missing: { title: 'cameraUnavailable', detail: 'cameraMissing' },
  busy: { title: 'cameraBusyTitle', detail: 'cameraBusy' },
  failed: { title: 'cameraFailedTitle', detail: 'cameraFailed' },
};

export default function Scanner({
  onCode,
  onCancel,
  onPaste,
}: {
  onCode: (code: string) => void;
  onCancel: () => void;
  onPaste: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false,
      stream: MediaStream | undefined,
      timer = 0;
    const fail = (error: unknown) => {
      if (!stopped) setProblem(cameraProblem(error, { secure: window.isSecureContext, available: Boolean(navigator.mediaDevices?.getUserMedia) }));
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(undefined);
      return;
    }
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
      .catch(fail);
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode, attempt]);
  return (
    <Sheet title={t('scanTitle')} onClose={onCancel}>
      {problem ? (
        <div className="scanner-problem" role="alert">
          <CameraOff size={22} />
          <strong>{t(PROBLEM_TEXT[problem].title)}</strong>
          <p>{t(PROBLEM_TEXT[problem].detail)}</p>
          <div className="scanner-actions">
            {canRetry(problem) && (
              <button
                onClick={() => {
                  setProblem(null);
                  setAttempt((value) => value + 1);
                }}
              >
                <RotateCcw size={15} />
                {t('cameraRetry')}
              </button>
            )}
            <button className="primary" onClick={onPaste}>
              <ClipboardPaste size={15} />
              {t('pasteInstead')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="scanner-frame">
            <video ref={video} playsInline muted aria-label={t('scanTitle')} />
          </div>
          <p className="sheet-hint scanner-hint">{t('scanHint')}</p>
        </>
      )}
    </Sheet>
  );
}
