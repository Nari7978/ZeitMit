-- Video dates get their own boundaries. The in-person list (holding hands, arm in arm, …) doesn't fit a call, so each
-- companion keeps a second list of what they're comfortable with on video (flirting, pet names, …), chosen from
-- VIDEO_BOUNDARY_OPTIONS in src/types.ts. Nobody has picked any yet, so it starts empty; the demo companion who offers
-- video dates gets a few, like the in-person ones the demo companions were seeded with.
ALTER TABLE companions ADD COLUMN video_boundaries TEXT NOT NULL DEFAULT '[]';
UPDATE companions SET video_boundaries = '["Flirting","Screenshots together","Watching or playing together"]' WHERE user_id = 'demo_yuki';
