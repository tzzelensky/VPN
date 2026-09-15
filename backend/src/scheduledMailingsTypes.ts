export type ScheduledMailingStatus = "pending" | "sent" | "cancelled" | "failed";

export type ScheduledMailingPayload = {
  mode: "global" | "single" | "selected" | "segment";
  text: string;
  title?: string;
  user_id?: number;
  user_ids?: number[];
  segment_id?: string;
  mark_enabled?: boolean;
  mark_text?: string;
  photo_base64?: string;
  photo_mime?: string;
  photo_name?: string;
  buttons?: string[];
};

export type ScheduledMailingJob = {
  id: string;
  send_at: string;
  created_at: string;
  status: ScheduledMailingStatus;
  error?: string;
  payload: ScheduledMailingPayload;
};

export type ScheduledMailingListItem = {
  id: string;
  send_at: string;
  created_at: string;
  status: ScheduledMailingStatus;
  error?: string;
  title: string;
  mode: ScheduledMailingPayload["mode"];
  segment_id?: string;
  text_preview: string;
  has_photo: boolean;
  mark_enabled: boolean;
};
