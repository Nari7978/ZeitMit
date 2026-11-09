import { parseJson } from './util';
import { DEFAULT_TZ } from './time';

export type CompanionRow = {
  user_id: string; display_name: string; age: number | null; show_age: number; pronouns: string | null; gender: string;
  area: string; dist: string; hue: number; photo_note: string; tagline: string; bio: string; rate: number;
  interests: string; languages: string; activities: string; boundaries: string; lgbtq: number; status: string;
  id_verified: number; rating: number | null; review_count: number; photo_id: string | null; id_photo_id: string | null;
  gallery: string; timezone: string | null;
};

/** Besides the profile photo, companions show this many more photos (the application needs the minimum). */
export const GALLERY_MIN = 3;
export const GALLERY_MAX = 6;

/** API shape, mirroring the mobile app's `Companion` type. */
export function toCompanion(r: CompanionRow) {
  return {
    id: r.user_id,
    name: r.display_name,
    age: r.show_age ? r.age : null,
    pron: r.pronouns ?? undefined,
    g: r.gender,
    area: r.area,
    dist: r.dist,
    rating: r.rating,
    reviews: r.review_count,
    rate: r.rate,
    verified: !!r.id_verified,
    lgbtq: !!r.lgbtq,
    hue: r.hue,
    photo: r.photo_note,
    tagline: r.tagline,
    interests: parseJson<string[]>(r.interests, []),
    langs: parseJson<[string, string][]>(r.languages, []),
    acts: parseJson<string[]>(r.activities, []),
    ok: parseJson<string[]>(r.boundaries, []),
    bio: r.bio,
    status: r.status,
    photoUrl: r.photo_id ? `/photos/${r.photo_id}` : null,
    gallery: parseJson<string[]>(r.gallery, []).map((id) => `/photos/${id}`),
    showAge: !!r.show_age,
    /** Her hours are in this zone (times are shown in each viewer's own zone). */
    tz: r.timezone || DEFAULT_TZ,
  };
}
