-- Make the newly added RFQ field available through PostgREST immediately.
notify pgrst, 'reload schema';
