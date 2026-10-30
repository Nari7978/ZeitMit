import type { ComponentType } from 'react';
import {
  AlarmClock, ArrowRight, ArrowUp, ArrowUpDown, BadgeCheck, Ban, Bell, Calendar, CalendarCheck, CalendarClock, CalendarDays,
  CalendarHeart, CalendarPlus, CalendarRange, CalendarX, Check, ChevronDown, ChevronLeft, ChevronRight, Circle,
  CircleAlert, CircleCheck, CircleUser, Clapperboard, Clock, Coffee, Compass, CreditCard, Dumbbell, Ellipsis, Euro,
  EyeOff, FileText, Flag, Footprints, Gamepad2, Gift, Globe, Heart, History, Hourglass, Inbox, Info, KeyRound,
  Landmark, Languages, Layers, LayoutDashboard, LifeBuoy, ListChecks, Lock, MapPin, MessageCircle, MessageSquareText,
  Minus, PartyPopper, Pencil, Phone, Plus, Receipt, Repeat, RotateCcw, ScanFace, Search, SearchX, Send, Share,
  ShieldAlert, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, TriangleAlert, User, UserRound, Users,
  UsersRound, Utensils, Video, Wallet, X, Camera, Ticket, ImagePlus, Images, IdCard, Mail, LogOut, Trash2, ExternalLink, Smartphone, Navigation,
  type LucideProps,
} from 'lucide-react-native';
import { colors } from '../theme';

// Kebab-case names match the `icon-*` classes used by the design.
const ICONS: Record<string, ComponentType<LucideProps>> = {
  'alarm-clock': AlarmClock, 'arrow-right': ArrowRight, 'arrow-up': ArrowUp, 'arrow-up-down': ArrowUpDown,
  'badge-check': BadgeCheck, ban: Ban, bell: Bell, calendar: Calendar, 'calendar-check': CalendarCheck, 'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays, 'calendar-heart': CalendarHeart, 'calendar-plus': CalendarPlus,
  'calendar-range': CalendarRange, 'calendar-x': CalendarX, check: Check, 'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, circle: Circle, 'circle-alert': CircleAlert,
  'circle-check': CircleCheck, 'circle-user': CircleUser, clapperboard: Clapperboard, clock: Clock, coffee: Coffee,
  compass: Compass, 'credit-card': CreditCard, dumbbell: Dumbbell, ellipsis: Ellipsis, euro: Euro, 'eye-off': EyeOff,
  'file-text': FileText, flag: Flag, footprints: Footprints, 'gamepad-2': Gamepad2, gift: Gift, globe: Globe,
  heart: Heart, history: History, hourglass: Hourglass, inbox: Inbox, info: Info, 'key-round': KeyRound,
  landmark: Landmark, languages: Languages, layers: Layers, 'layout-dashboard': LayoutDashboard,
  'life-buoy': LifeBuoy, 'list-checks': ListChecks, lock: Lock, 'map-pin': MapPin, 'message-circle': MessageCircle,
  'message-square-text': MessageSquareText, minus: Minus, 'party-popper': PartyPopper, pencil: Pencil, phone: Phone,
  plus: Plus, receipt: Receipt, repeat: Repeat, 'rotate-ccw': RotateCcw, 'scan-face': ScanFace, search: Search,
  'search-x': SearchX, send: Send, share: Share, 'shield-alert': ShieldAlert, 'shield-check': ShieldCheck,
  'shopping-bag': ShoppingBag, 'sliders-horizontal': SlidersHorizontal, sparkles: Sparkles,
  'triangle-alert': TriangleAlert, user: User, 'user-round': UserRound, users: Users, 'users-round': UsersRound,
  utensils: Utensils, video: Video, wallet: Wallet, x: X, camera: Camera, ticket: Ticket, 'image-plus': ImagePlus, images: Images, 'id-card': IdCard,
  mail: Mail, 'log-out': LogOut, 'trash-2': Trash2, 'external-link': ExternalLink, smartphone: Smartphone, navigation: Navigation,
};

type Props = { name: string; size?: number; color?: string; strokeWidth?: number; style?: LucideProps['style'] };

export function Icon({ name, size = 20, color = colors.ink, strokeWidth = 2, style }: Props) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    if (__DEV__) console.warn(`Icon "${name}" is not registered`);
    return null;
  }
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}
