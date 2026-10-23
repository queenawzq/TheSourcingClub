/**
 * The bell and its Activity drawer, for both dashboards.
 *
 * The badge is the company's unread count, counted in the database. It
 * follows the notifications table over Realtime, so a new notification (or
 * one read in another tab) moves it without a refresh; the read policy limits
 * what a subscriber hears to its own company's rows. The open drawer reloads
 * with it. "Mark all read" is how a badge longer than the drawer is cleared.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityDrawer } from "../../prototype/main.jsx";
import {
  activityType, countUnreadNotifications, listNotifications, markAllRead, markRead, notificationBody, notificationLink, timeAgo,
} from "../../lib/domain/notifications.js";
import { supabase } from "../../lib/supabase.js";
import { useRouter } from "../../lib/router.jsx";
import "../notifications.css";

const DRAWER_LIMIT = 100;

/** A notification as a row of the designed Activity drawer. */
function toActivityItem(notification) {
  return {
    id: notification.id,
    notification,
    type: activityType(notification.kind),
    title: notification.title,
    meta: notificationBody(notification),
    time: timeAgo(notification.created_at),
    unread: !notification.read_at,
  };
}

/**
 * @returns {{ unreadCount: number, openActivity: () => void, activityDrawer: React.ReactNode }}
 */
export function useActivity(orgId, { isFactory, description, onError }) {
  const { navigate } = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  // null while the drawer is shut; { items: null } while it loads.
  const [drawer, setDrawer] = useState(null);
  const [marking, setMarking] = useState(false);
  const isOpen = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refreshCount = useCallback(
    () => countUnreadNotifications(orgId).then(setUnreadCount, (failure) => onErrorRef.current?.(failure)),
    [orgId],
  );

  const loadItems = useCallback(async () => {
    try {
      const rows = await listNotifications(orgId, { limit: DRAWER_LIMIT });
      if (isOpen.current) setDrawer({ items: (rows ?? []).map(toActivityItem) });
    } catch (failure) {
      onErrorRef.current?.(failure);
    }
  }, [orgId]);

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
      emptyText={drawer.items ? "No notifications yet." : "Loading…"}
      onMarkAllRead={markAllActivityRead}
      markAllDisabled={marking || unreadCount === 0}
      onOpenItem={openActivityItem}
      onClose={closeActivity}
    />
  ) : null;

  return { unreadCount, openActivity, activityDrawer };
}
