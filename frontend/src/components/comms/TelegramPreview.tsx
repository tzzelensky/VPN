import { useEffect, useState } from "react";
import { buttonLabel, type MessageButtonId } from "./commsTypes";

type Props = {
  brandName: string;
  markEnabled: boolean;
  markText: string;
  text: string;
  photo: File | null;
  buttons: MessageButtonId[];
};

export default function TelegramPreview({ brandName, markEnabled, markText, text, photo, buttons }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const body = text.trim();
  const mark = markEnabled ? markText.trim() : "";

  return (
    <section className="comms-wiz-card comms-wiz-preview">
      <h2 className="comms-wiz-h2">Предпросмотр</h2>
      <p className="comms-wiz-hint">Как сообщение увидит пользователь в Telegram</p>

      <div className="comms-tg-preview">
        <div className="comms-tg-preview__header">{brandName || "HSN VPN"}</div>
        <div className="comms-tg-preview__bubble">
          {photoUrl ? (
            <img className="comms-tg-preview__photo" src={photoUrl} alt="" />
          ) : null}
          {mark ? <div className="comms-tg-preview__mark">{mark}</div> : null}
          {body ? (
            <div className="comms-tg-preview__text">{body}</div>
          ) : (
            <div className="comms-tg-preview__placeholder">Текст сообщения появится здесь</div>
          )}
          {buttons.length > 0 ? (
            <div className="comms-tg-preview__buttons">
              {buttons.map((id) => (
                <span key={id} className="comms-tg-preview__btn">
                  {buttonLabel(id)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
