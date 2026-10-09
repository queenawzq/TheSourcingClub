/**
 * What needs your attention.
 *
 * Both dashboards design a panel like this. The rows have existed since
 * award_quote was written — a factory has been told it won or lost this whole
 * time, and nothing showed it.
 */
import React, { useCallback, useEffect, useState } from "react";
import { listNotifications, markAllRead, markRead, notificationLink, timeAgo as ago } from "../lib/domain/notifications.js";
import { useRouter } from "../lib/router.jsx";
import "./notifications.css";

export default function NotificationList({ org, isFactory }) {
  const { navigate } = useRouter();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    listNotifications(org.id).then(setItems).catch(setError);
  }, [org.id]);

  useEffect(load, [load]);

  if (error) return <p className="shell-note">{error.message}</p>;
  if (!items || items.length === 0) return null;

  const unread = items.filter((item) => !item.read_at);

  async function open(item) {
    if (!item.read_at) {
      await markRead(item.id).catch(() => {});
      load();
    }
    const link = notificationLink(item, { isFactory });
    if (link) navigate(link);
  }

  return (
    <section className="notif" data-testid="notifications">
      <header className="notif-head">
        <h2>
          Needs your attention
          {unread.length ? <span className="notif-count">{unread.length}</span> : null}
        </h2>
        {unread.length ? (
          <button
            type="button"
            className="quiet-btn"
            onClick={async () => {
              await markAllRead(org.id);
              load();
            }}
          >
            Mark all read
          </button>
        ) : null}
      </header>

      <ul className="notif-list">
        {items.slice(0, 6).map((item) => (
          <li key={item.id} className={item.read_at ? undefined : "is-unread"}>
            <button type="button" onClick={() => open(item)}>
              <span className="notif-title">{item.title}</span>
              {item.body ? <span className="notif-body">{item.body}</span> : null}
              <span className="notif-time">{ago(item.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
