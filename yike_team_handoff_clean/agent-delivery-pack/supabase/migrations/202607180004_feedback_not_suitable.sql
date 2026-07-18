alter table public.feedback_events
  drop constraint if exists feedback_events_action_check;

alter table public.feedback_events
  add constraint feedback_events_action_check
  check (action in ('accept', 'complete', 'reroll', 'not_suitable', 'later', 'dislike', 'save_preset'));
