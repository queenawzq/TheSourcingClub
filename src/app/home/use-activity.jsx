/**
 * The bell and its Activity drawer, for both dashboards.
 *
 * The badge is the company's unread count, counted in the database. It
 * follows the notifications table over Realtime, so a new notification (or
 * one read in another tab) moves it without a refresh; the read policy limits
 * what a subscriber hears to its own company's rows. The open drawer reloads
 * with it. "Mark all read" is how a badge longer than the drawer is cleared.
 *
 * The drawer is the only list of notifications: `/notifications` lands on the
 * dashboard as `/?activity=open`, which opens it.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityDrawer } from "../../prototype/main.jsx";
import {
  activityType, countUnreadNotifications, listNotifications, markAllRead, markRead, notificationBody, notificationLink, notificationTitle, timeAgo,
} from "../../lib/domain/notifications.js";
import { supabase } from "../../lib/supabase.js";
import { reviewNoteText } from "../../shared/review-note.mjs";
import { useRouter } from "../../lib/router.jsx";
import { requestEnglishContent } from "../content-translation.js";
import "../notifications.css";

const DRAWER_LIMIT = 100;

// The title says what happened. The body stays where it carries something the
// title can't: what someone wrote, a reason, what went wrong, or what staff
// changed on the profile ("We updated your company address.").
const WORDS_MATTER = /^(message|payment_failed|funds_released|verification_|order_cancel|cancel|call_|milestone_update|payout_|referral_|credits_|profile_updated)/;

/** A notification as a row of the designed Activity drawer, in the reader's language. */
function toActivityItem(notification, locale = "en") {
  return {
    id: notification.id,
    notification,
    type: activityType(notification.kind, locale),
    title: notificationTitle(notification, { locale }),
    meta: !WORDS_MATTER.test(notification.kind) ? ""
      // A staff note on a review decision, with its "- " lines as bullets, like its email.
      : String(notification.kind ?? "").startsWith("verification_") ? reviewNoteText(notificationBody(notification, { locale }))
        : notificationBody(notification, { locale }),
    time: timeAgo(notification.created_at, locale),
    unread: !notification.read_at,
  };
}

/**
 * The reader's language for the bell: the one the page passes (`language`),
 * else this person's saved `user_profiles.locale` (what their emails use), else
 * English. Read once per person; a failed read is English.
 */
function useReaderLocale(language) {
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    if (language) return undefined;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;
      const { data } = await supabase.from("user_profiles").select("locale").eq("id", userId).maybeSingle();
      if (!cancelled) setSaved(data?.locale === "zh" ? "zh" : "en");
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [language]);
  const chosen = language ?? saved;
  return chosen === "zh" ? "zh" : "en";
}

/**
 * @returns {{ unreadCount: number, openActivity: () => void, activityDrawer: React.ReactNode }}
 */
export function useActivity(orgId, { isFactory, description, onError, language }) {
  const { navigate } = useRouter();
  const locale = useReaderLocale(language);
  const [unreadCount, setUnreadCount] = useState(0);
  // null while the drawer is shut; { items: null } while it loads.
  const [drawer, setDrawer] = useState(null);
  const [marking, setMarking] = useState(false);
  const isOpen = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refreshCount = useCallback(
    // A missing badge is not worth a message on the dashboard.
    () => countUnreadNotifications(orgId).then(setUnreadCount, (failure) => console.warn("unread count", failure?.message)),
    [orgId],
  );

  const loadItems = useCallback(async () => {
    try {
      const rows = await listNotifications(orgId, { limit: DRAWER_LIMIT });
      // A brand reads the steps a factory named in Chinese in English, as on the order (BrandEnglishLayer).
      const orderIds = [...new Set((rows ?? []).map((row) => row.order_id).filter(Boolean))];
      if (!isFactory && orderIds.length) requestEnglishContent({ orderIds });
      if (isOpen.current) setDrawer({ items: (rows ?? []).map((row) => toActivityItem(row, locale)) });
    } catch (failure) {
      onErrorRef.current?.(failure);
    }
  }, [orgId, locale, isFactory]);

  // The language arrived (or changed) with the drawer open: say it again.
  useEffect(() => { if (isOpen.current) loadItems(); }, [loadItems]);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  // Marking everything read sends one change per row, so changes are
  // gathered for a moment before recounting.
  useEffect(() => {
    let timer = null;
    const channel = supabase
      .channel(`notifications:${orgId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `org_id=eq.${orgId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          refreshCount();
          if (isOpen.current) loadItems();
        }, 300);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [orgId, refreshCount, loadItems]);

  /** Opening the drawer is not the same as reading every activity. */
  function openActivity() {
    isOpen.current = true;
    setDrawer({ items: null });
    loadItems();
  }

  function closeActivity() {
    isOpen.current = false;
    setDrawer(null);
  }

  // Arriving from /notifications: open the drawer once, and drop the query
  // so a refresh or Back does not open it again.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("activity") !== "open") return;
    navigate("/", { replace: true });
    openActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRowUnread = (id, unread) => setDrawer((current) => (current?.items ? {
    items: current.items.map((row) => (row.id === id ? { ...row, unread } : row)),
  } : current));

  async function openActivityItem(item) {
    const link = notificationLink(item.notification, { isFactory });
    if (item.unread) {
      setRowUnread(item.id, false);
      setUnreadCount((count) => Math.max(0, count - 1));
      try {
        await markRead(item.id);
      } catch (failure) {
        setRowUnread(item.id, true);
        setUnreadCount((count) => count + 1);
        onErrorRef.current?.(failure);
        return;
      }
    }
    if (link) {
      closeActivity();
      navigate(link);
    }
  }

  async function markAllActivityRead() {
    setMarking(true);
    try {
      await markAllRead(orgId);
      setUnreadCount(0);
      setDrawer((current) => (current?.items ? { items: current.items.map((row) => ({ ...row, unread: false })) } : current));
    } catch (failure) {
      onErrorRef.current?.(failure);
    } finally {
      setMarking(false);
    }
  }

  const activityDrawer = drawer ? (
    <ActivityDrawer
      items={drawer.items ?? []}
      description={description}
      emptyText={drawer.items ? (locale === "zh" ? "暂无通知。" : "No notifications yet.") : (locale === "zh" ? "加载中…" : "Loading…")}
      onMarkAllRead={markAllActivityRead}
      markAllDisabled={marking || unreadCount === 0}
      onOpenItem={openActivityItem}
      onClose={closeActivity}
    />
  ) : null;

  return { unreadCount, openActivity, activityDrawer };
}
