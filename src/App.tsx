import { useState } from "react"

// ─── Types ───────────────────────────────────────────────────────────────────
type Page = "landing" | "alumni-profile" | "student-dashboard" | "alumni-dashboard" | "events" | "messaging" | "communities" | "admin"

// ─── Data ────────────────────────────────────────────────────────────────────
const alumni = [
  {
    id: 1,
    name: "Dr. Amina Osei",
    year: "Class of 2014",
    role: "Senior Data Scientist",
    company: "Google DeepMind",
    industry: "Technology",
    location: "Nairobi, Kenya",
    available: true,
    img: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=120&h=120&fit=crop&auto=format",
    areas: ["Data Science", "Machine Learning", "Python"],
    cover:
      "https://images.unsplash.com/photo-1573164713714-d95e436ab8d6?w=900&h=220&fit=crop&auto=format",
    bio: "Passionate about using data to solve real-world problems across Africa. I mentor students interested in AI/ML careers.",
  },
  {
    id: 2,
    name: "James Mwangi",
    year: "Class of 2011",
    role: "VP of Engineering",
    company: "Safaricom",
    industry: "Telecommunications",
    location: "Nairobi, Kenya",
    available: true,
    img: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&h=120&fit=crop&auto=format",
    areas: ["Software Engineering", "Leadership", "Mobile Tech"],
    cover:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&h=220&fit=crop&auto=format",
    bio: "15 years in tech, from mobile payments to cloud infrastructure. Happy to guide students navigating the East African tech ecosystem.",
  },
  {
    id: 3,
    name: "Faith Kimani",
    year: "Class of 2017",
    role: "Investment Analyst",
    company: "African Development Bank",
    industry: "Finance",
    location: "Abidjan, Côte d'Ivoire",
    available: false,
    img: "https://images.unsplash.com/photo-1523824921871-d6f1a15151f1?w=120&h=120&fit=crop&auto=format",
    areas: ["Finance", "Investment Banking", "Excel Modeling"],
    cover:
      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=900&h=220&fit=crop&auto=format",
    bio: "Helping students break into finance in Africa and globally. Love talking about markets, careers, and personal branding.",
  },
  {
    id: 4,
    name: "Brian Otieno",
    year: "Class of 2015",
    role: "Founder & CEO",
    company: "AgriTech Kenya",
    industry: "Agriculture & Tech",
    location: "Kisumu, Kenya",
    available: true,
    img: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&h=120&fit=crop&auto=format",
    areas: ["Entrepreneurship", "Product", "Agritech"],
    cover:
      "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=900&h=220&fit=crop&auto=format",
    bio: "Building agricultural solutions for smallholder farmers. Mentor entrepreneurs and product managers on building for emerging markets.",
  },
  {
    id: 5,
    name: "Grace Njoroge",
    year: "Class of 2019",
    role: "UX Design Lead",
    company: "Andela",
    industry: "Design & Tech",
    location: "Lagos, Nigeria",
    available: true,
    img: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=120&h=120&fit=crop&auto=format",
    areas: ["UX Design", "Product Design", "Figma"],
    cover:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=900&h=220&fit=crop&auto=format",
    bio: "Designing products used by millions. Passionate about African user research and inclusive design.",
  },
  {
    id: 6,
    name: "Samuel Kariuki",
    year: "Class of 2013",
    role: "Marketing Director",
    company: "Equity Group Holdings",
    industry: "Financial Services",
    location: "Nairobi, Kenya",
    available: false,
    img: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&h=120&fit=crop&auto=format",
    areas: ["Marketing", "Brand Strategy", "Digital Marketing"],
    cover:
      "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=900&h=220&fit=crop&auto=format",
    bio: "10 years building brands in East Africa. Can guide students in marketing careers, personal branding, and digital strategy.",
  },
]

const events = [
  {
    id: 1,
    title: "Annual Alumni Gala 2026",
    date: "October 15, 2026",
    time: "6:00 PM EAT",
    location: "Strathmore University, Main Hall",
    type: "In-Person",
    img: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&h=300&fit=crop&auto=format",
    desc: "Celebrate another year of outstanding alumni achievements. Networking dinner, awards ceremony, and keynote by notable alumni.",
    tag: "Reunion",
  },
  {
    id: 2,
    title: "Tech Career Fair 2026",
    date: "September 5, 2026",
    time: "9:00 AM – 4:00 PM",
    location: "Online + On-Campus",
    type: "Hybrid",
    img: "https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=600&h=300&fit=crop&auto=format",
    desc: "Connect with top tech companies hiring from Strathmore. Over 40 companies in attendance. CV review sessions available.",
    tag: "Career Fair",
  },
  {
    id: 3,
    title: "Mentorship Webinar: Breaking into Finance",
    date: "August 22, 2026",
    time: "7:00 PM EAT",
    location: "Zoom (link sent on registration)",
    type: "Online",
    img: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=300&fit=crop&auto=format",
    desc: "Faith Kimani and two other alumni share their journeys into investment banking and corporate finance.",
    tag: "Webinar",
  },
  {
    id: 4,
    title: "Nairobi Tech Professionals Mixer",
    date: "August 30, 2026",
    time: "5:30 PM EAT",
    location: "iHub, Nairobi",
    type: "In-Person",
    img: "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=600&h=300&fit=crop&auto=format",
    desc: "Monthly networking for tech-focused alumni in Nairobi. Bring business cards. Complimentary drinks and snacks.",
    tag: "Networking",
  },
]

const communities = [
  {
    id: 1,
    name: "Class of 2022",
    members: 342,
    img: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=400&h=200&fit=crop&auto=format",
    desc: "4-year reunion planning, class updates, and keeping the spirit of 2022 alive.",
    activity: "Active 2 hours ago",
  },
  {
    id: 2,
    name: "School of Computing",
    members: 1204,
    img: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&h=200&fit=crop&auto=format",
    desc: "Tech discussions, job posts, and collaborative projects for computing alumni.",
    activity: "Active 15 minutes ago",
  },
  {
    id: 3,
    name: "Business Alumni Network",
    members: 876,
    img: "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&h=200&fit=crop&auto=format",
    desc: "Entrepreneurs, MBA grads, and business leaders sharing insights and opportunities.",
    activity: "Active 1 hour ago",
  },
  {
    id: 4,
    name: "Nairobi Tech Professionals",
    members: 523,
    img: "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=400&h=200&fit=crop&auto=format",
    desc: "Local tech events, hackathons, and career opportunities in the Nairobi ecosystem.",
    activity: "Active 45 minutes ago",
  },
  {
    id: 5,
    name: "International Alumni",
    members: 289,
    img: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400&h=200&fit=crop&auto=format",
    desc: "Connecting Strathmordians across the globe — UK, US, Germany, UAE, and beyond.",
    activity: "Active 3 hours ago",
  },
  {
    id: 6,
    name: "Women in Leadership",
    members: 418,
    img: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=200&fit=crop&auto=format",
    desc: "Empowering women alumni through mentorship, advocacy, and professional development.",
    activity: "Active 30 minutes ago",
  },
]

const conversations = [
  {
    id: 1,
    name: "Dr. Amina Osei",
    preview: "Sure! Let's schedule a call this week.",
    time: "10:32 AM",
    unread: 2,
    online: true,
    img: alumni[0].img,
  },
  {
    id: 2,
    name: "James Mwangi",
    preview: "The internship positions open in September.",
    time: "Yesterday",
    unread: 0,
    online: false,
    img: alumni[1].img,
  },
  {
    id: 3,
    name: "Grace Njoroge",
    preview: "I reviewed your portfolio — really strong!",
    time: "Mon",
    unread: 1,
    online: true,
    img: alumni[4].img,
  },
  {
    id: 4,
    name: "Brian Otieno",
    preview: "What aspect of entrepreneurship excites you?",
    time: "Sun",
    unread: 0,
    online: false,
    img: alumni[3].img,
  },
]

const messages = [
  {
    id: 1,
    from: "them",
    text: "Hi Kevin! I saw your request for mentorship in Data Science. Happy to help!",
    time: "10:15 AM",
  },
  {
    id: 2,
    from: "me",
    text: "Thank you so much, Dr. Amina! I'm particularly interested in getting into ML engineering.",
    time: "10:18 AM",
  },
  {
    id: 3,
    from: "them",
    text: "Great choice. Google DeepMind is always looking for strong ML engineers from African universities. Let's start with your CV.",
    time: "10:20 AM",
  },
  {
    id: 4,
    from: "me",
    text: "I'd love that. I've been working on some NLP projects — should I share them with you?",
    time: "10:25 AM",
  },
  {
    id: 5,
    from: "them",
    text: "Absolutely! Share a link or PDF. Also, are you free for a 30-min call Thursday evening?",
    time: "10:28 AM",
  },
  {
    id: 6,
    from: "me",
    text: "Yes, Thursday works perfectly! I'll send the projects now.",
    time: "10:30 AM",
  },
  {
    id: 7,
    from: "them",
    text: "Sure! Let's schedule a call this week.",
    time: "10:32 AM",
  },
]

// ─── Icons (inline SVG) ──────────────────────────────────────────────────────
const Icon = {
  Home: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  Search: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Users: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  MessageCircle: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  User: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Bell: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  Calendar: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Briefcase: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  ChevronRight: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  Star: () => (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-4 h-4 text-yellow-400"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  Video: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  Paperclip: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  Send: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  Award: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  ),
  TrendingUp: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  Globe: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  MapPin: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  CheckCircle: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  Settings: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Menu: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-6 h-6"
    >
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  X: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-6 h-6"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Heart: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  BookOpen: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  Upload: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  ),
  BarChart2: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  Plus: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
}

// ─── Reusable components ─────────────────────────────────────────────────────
function Btn({
  children,
  variant = "primary",
  size = "md",
  className = "",
  onClick,
}: {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "outline" | "gold"
  size?: "sm" | "md" | "lg"
  className?: string
  onClick?: () => void
}) {
  const base =
    "inline-flex items-center justify-center font-semibold rounded-xl transition-all cursor-pointer select-none"
  const sizes = {
    sm: "px-3 py-1.5 text-sm gap-1.5",
    md: "px-5 py-2.5 text-sm gap-2",
    lg: "px-7 py-3.5 text-base gap-2",
  }
  const variants = {
    primary:
      "bg-[#0B6B3A] text-white hover:bg-[#094F2B] active:scale-[0.98] shadow-sm",
    secondary:
      "bg-[#E8F4EE] text-[#0B6B3A] hover:bg-[#d4ecde] active:scale-[0.98]",
    outline:
      "border border-[#D6E4DA] bg-white text-[#0F1A14] hover:bg-[#F0F4F1] active:scale-[0.98]",
    gold: "bg-[#D4A017] text-white hover:bg-[#B8881A] active:scale-[0.98] shadow-sm",
  }
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function AlumniCard({ a, onView }: { a: typeof alumni[0] onView: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-[#D6E4DA] overflow-hidden card-hover">
      <div className="h-20 bg-gradient-to-r from-[#0B6B3A] to-[#0E8A4A] relative">
        <div className="absolute -bottom-8 left-5">
          <div className="relative">
            <img
              src={a.img}
              alt={a.name}
              className="w-16 h-16 rounded-full border-3 border-white object-cover"
              style={{ border: "3px solid white" }}
            />
            {a.available && <span className="badge-online" />}
          </div>
        </div>
      </div>
      <div className="pt-10 px-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-[#0F1A14] text-base">{a.name}</h3>
            <p className="text-sm text-[#5A7263]">{a.role}</p>
            <p className="text-sm text-[#5A7263]">{a.company}</p>
          </div>
          <span className="gold-tag">{a.year.split(" ")[2]}</span>
        </div>
        <div className="flex items-center gap-1 mt-2 text-xs text-[#5A7263]">
          <Icon.MapPin />
          {a.location}
        </div>
        <div className="flex flex-wrap gap-1 mt-3">
          <span className="tag">{a.industry}</span>
          {a.available && (
            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
              Available
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <Btn variant="primary" size="sm" className="flex-1" onClick={onView}>
            View Profile
          </Btn>
          <Btn variant="outline" size="sm" className="flex-1">
            Mentor Request
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ─── Navbar ──────────────────────────────────────────────────────────────────
function Navbar({ page, setPage }: { page: Page setPage: (p: Page) => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const links: { label: string p: Page }[] = [
    { label: "Home", p: "landing" },
    { label: "Find Alumni", p: "landing" },
    { label: "Mentorship", p: "alumni-profile" },
    { label: "Events", p: "events" },
    { label: "Communities", p: "communities" },
  ]
  return (
    <nav className="bg-white border-b border-[#D6E4DA] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-16 gap-6">
        <button
          className="flex items-center gap-2 mr-2 flex-shrink-0"
          onClick={() => setPage("landing")}
        >
          <div className="w-8 h-8 rounded-lg bg-[#0B6B3A] flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="font-bold text-[#0F1A14] hidden sm:block text-sm leading-tight">
            Strathmore
            <br />
            <span className="text-[#0B6B3A]">Alumni Connect</span>
          </span>
        </button>
        <div className="hidden md:flex items-center gap-1 flex-1">
          {links.map(({ label, p }) => (
            <button
              key={label}
              onClick={() => setPage(p)}
              className={`nav-link px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                page === p && label === "Home"
                  ? "text-[#0B6B3A] active"
                  : "text-[#5A7263] hover:text-[#0F1A14]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 md:flex-none" />
        <div className="hidden md:flex items-center gap-2">
          <button
            className="p-2 rounded-lg hover:bg-[#F0F4F1] text-[#5A7263] relative"
            onClick={() => setPage("messaging")}
          >
            <Icon.MessageCircle />
            <span className="absolute top-1 right-1 w-2 h-2 bg-[#D4A017] rounded-full" />
          </button>
          <button className="p-2 rounded-lg hover:bg-[#F0F4F1] text-[#5A7263] relative">
            <Icon.Bell />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>
          <Btn
            variant="outline"
            size="sm"
            onClick={() => setPage("student-dashboard")}
          >
            Student
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            onClick={() => setPage("alumni-dashboard")}
          >
            Alumni
          </Btn>
        </div>
        <button
          className="md:hidden p-2 text-[#5A7263]"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <Icon.X /> : <Icon.Menu />}
        </button>
      </div>
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-[#D6E4DA] px-4 py-3 flex flex-col gap-1">
          {links.map(({ label, p }) => (
            <button
              key={label}
              onClick={() => {
                setPage(p)
                setMobileOpen(false)
              }}
              className="text-left px-3 py-2.5 text-sm font-medium text-[#0F1A14] rounded-lg hover:bg-[#F0F4F1]"
            >
              {label}
            </button>
          ))}
          <div className="flex gap-2 pt-2 border-t border-[#D6E4DA]">
            <Btn
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                setPage("student-dashboard")
                setMobileOpen(false)
              }}
            >
              Student
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => {
                setPage("alumni-dashboard")
                setMobileOpen(false)
              }}
            >
              Alumni
            </Btn>
          </div>
        </div>
      )}
    </nav>
  )
}

// ─── Mobile bottom nav ────────────────────────────────────────────────────────
function MobileNav({
  page,
  setPage,
}: {
  page: Page
  setPage: (p: Page) => void
}) {
  const items = [
    { label: "Home", p: "landing" as Page, icon: <Icon.Home /> },
    { label: "Search", p: "landing" as Page, icon: <Icon.Search /> },
    { label: "Mentors", p: "alumni-profile" as Page, icon: <Icon.Users /> },
    { label: "Messages", p: "messaging" as Page, icon: <Icon.MessageCircle /> },
    { label: "Profile", p: "student-dashboard" as Page, icon: <Icon.User /> },
  ]
  return (
    <div className="bottom-nav md:hidden">
      {items.map(({ label, p, icon }) => (
        <button
          key={label}
          className={`bottom-nav-item ${page === p ? "active" : ""}`}
          onClick={() => setPage(p)}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Landing Page ─────────────────────────────────────────────────────────────
function LandingPage({ setPage }: { setPage: (p: Page) => void }) {
  const [searchQ, setSearchQ] = useState("")
  const [filterIndustry, setFilterIndustry] = useState("All")
  const [filterYear, setFilterYear] = useState("All")
  const industries = [
    "All",
    "Technology",
    "Finance",
    "Telecommunications",
    "Design & Tech",
    "Agriculture & Tech",
    "Financial Services",
  ]
  const years = ["All", "2011", "2013", "2014", "2015", "2017", "2019"]

  const filtered = alumni.filter((a) => {
    const q = searchQ.toLowerCase()
    const matchQ =
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.company.toLowerCase().includes(q) ||
      a.industry.toLowerCase().includes(q)
    const matchI = filterIndustry === "All" || a.industry === filterIndustry
    const matchY = filterYear === "All" || a.year.includes(filterYear)
    return matchQ && matchI && matchY
  })

  return (
    <div className="fade-in">
      {/* Hero */}
      <section className="hero-pattern relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-[#E8F4EE] text-[#0B6B3A] text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0B6B3A]" />
              3,200+ Alumni · 48 Countries
            </div>
            <h1 className="dm-serif text-4xl md:text-5xl leading-tight text-[#0F1A14] mb-4">
              Connect with Alumni.
              <br />
              <span className="text-[#0B6B3A]">Learn from</span>{" "}
              <span className="text-[#D4A017]">Experience.</span>
              <br />
              Build Your Career.
            </h1>
            <p className="text-[#5A7263] text-lg leading-relaxed mb-8 max-w-lg">
              Search for Strathmore alumni mentors, receive personalized career
              guidance, explore internship opportunities, and build the
              professional network that lasts a lifetime.
            </p>
            <div className="flex flex-wrap gap-3">
              <Btn
                variant="primary"
                size="lg"
                onClick={() => {
                  const el = document.getElementById("search-section")
                  el?.scrollIntoView({ behavior: "smooth" })
                }}
              >
                <Icon.Search /> Find a Mentor
              </Btn>
              <Btn
                variant="outline"
                size="lg"
                onClick={() => setPage("alumni-dashboard")}
              >
                Join as Alumni
              </Btn>
            </div>
            <div className="flex gap-8 mt-10">
              {[
                ["3,200+", "Alumni"],
                ["420+", "Mentors"],
                ["850+", "Sessions"],
                ["48", "Countries"],
              ].map(([num, label]) => (
                <div key={label}>
                  <div className="text-2xl font-bold text-[#0B6B3A]">{num}</div>
                  <div className="text-xs text-[#5A7263] font-medium">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="hidden md:block relative">
            <div className="rounded-3xl overflow-hidden shadow-2xl shadow-green-900/20">
              <img
                src="https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=580&h=420&fit=crop&auto=format"
                alt="Students networking and collaborating"
                className="w-full h-80 object-cover"
              />
            </div>
            {/* Floating cards */}
            <div className="absolute -bottom-4 -left-6 bg-white rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3 border border-[#D6E4DA]">
              <img
                src={alumni[0].img}
                alt=""
                className="w-10 h-10 rounded-full object-cover"
              />
              <div>
                <p className="text-xs font-semibold text-[#0F1A14]">
                  Dr. Amina Osei
                </p>
                <p className="text-xs text-[#5A7263]">
                  Google DeepMind · Data Scientist
                </p>
              </div>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium ml-2">
                Available
              </span>
            </div>
            <div className="absolute -top-4 -right-4 bg-white rounded-2xl shadow-lg px-4 py-3 border border-[#D6E4DA]">
              <p className="text-xs text-[#5A7263] font-medium">This week</p>
              <p className="text-lg font-bold text-[#0B6B3A]">24 sessions</p>
              <p className="text-xs text-[#5A7263]">booked with mentors</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features strip */}
      <section className="bg-[#0B6B3A] py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            {
              icon: <Icon.Users />,
              label: "1-on-1 Mentorship",
              sub: "Book sessions with experienced alumni",
            },
            {
              icon: <Icon.Briefcase />,
              label: "Career Opportunities",
              sub: "Internships & job referrals",
            },
            {
              icon: <Icon.Calendar />,
              label: "Events & Webinars",
              sub: "Reunions, fairs & networking",
            },
            {
              icon: <Icon.Globe />,
              label: "Global Network",
              sub: "Alumni in 48 countries",
            },
          ].map(({ icon, label, sub }) => (
            <div key={label} className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-white flex-shrink-0">
                {icon}
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{label}</p>
                <p className="text-white/70 text-xs mt-0.5">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Search section */}
      <section
        id="search-section"
        className="py-16 max-w-7xl mx-auto px-4 sm:px-6"
      >
        <div className="text-center mb-10">
          <h2 className="dm-serif text-3xl text-[#0F1A14] mb-3">
            Find Your Mentor
          </h2>
          <p className="text-[#5A7263]">
            Search 420+ alumni ready to guide your career journey
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm mb-8">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A7263]">
                <Icon.Search />
              </div>
              <input
                type="text"
                placeholder="Search by name, company, or skill..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#D6E4DA] text-sm bg-[#F7F9F7] focus:bg-white transition-colors"
              />
            </div>
            <select
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              className="px-4 py-3 rounded-xl border border-[#D6E4DA] text-sm bg-[#F7F9F7] text-[#0F1A14] min-w-40 cursor-pointer"
            >
              {industries.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="px-4 py-3 rounded-xl border border-[#D6E4DA] text-sm bg-[#F7F9F7] text-[#0F1A14] min-w-36 cursor-pointer"
            >
              {years.map((y) => (
                <option key={y}>
                  {y === "All" ? "All Years" : `Class of ${y}`}
                </option>
              ))}
            </select>
            <Btn variant="primary" size="md">
              Search
            </Btn>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              "Available Now",
              "Data Science",
              "Finance",
              "Software Engineering",
              "Entrepreneurship",
            ].map((tag) => (
              <button
                key={tag}
                className="text-xs bg-[#F0F4F1] text-[#5A7263] px-3 py-1 rounded-full hover:bg-[#E8F4EE] hover:text-[#0B6B3A] transition-colors font-medium"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-[#5A7263] py-12">
            No alumni match your search. Try different filters.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((a) => (
              <AlumniCard
                key={a.id}
                a={a}
                onView={() => setPage("alumni-profile")}
              />
            ))}
          </div>
        )}
      </section>

      {/* Alumni Stories */}
      <section className="bg-white border-t border-[#D6E4DA] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="dm-serif text-3xl text-[#0F1A14] mb-2">
                Alumni Success Stories
              </h2>
              <p className="text-[#5A7263]">
                Hear from those who came before you
              </p>
            </div>
            <Btn variant="secondary" size="sm">
              View All <Icon.ChevronRight />
            </Btn>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                q: "Mentorship from a Strathmore alumnus helped me land my dream job at Google. The network here is truly world-class.",
                name: "Kevin Otieno",
                role: "Software Engineer at Google",
                year: "Class of 2021",
                img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&auto=format",
              },
              {
                q: "Through the Alumni Connect platform, I found an internship at African Development Bank that turned into a full-time role.",
                name: "Mercy Wanjiku",
                role: "Investment Analyst",
                year: "Class of 2022",
                img: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=80&h=80&fit=crop&auto=format",
              },
              {
                q: "The mentorship sessions I had as a student shaped how I lead teams today. Now I give back as a mentor myself.",
                name: "Peter Kamau",
                role: "CTO at M-Pesa Africa",
                year: "Class of 2010",
                img: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=80&h=80&fit=crop&auto=format",
              },
            ].map(({ q, name, role, year, img }) => (
              <div
                key={name}
                className="bg-[#F7F9F7] rounded-2xl p-6 border border-[#D6E4DA]"
              >
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Icon.Star key={i} />
                  ))}
                </div>
                <p className="text-[#0F1A14] text-sm leading-relaxed mb-5 italic">
                  "{q}"
                </p>
                <div className="flex items-center gap-3">
                  <img
                    src={img}
                    alt={name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  <div>
                    <p className="font-semibold text-[#0F1A14] text-sm">
                      {name}
                    </p>
                    <p className="text-xs text-[#5A7263]">{role}</p>
                    <span className="gold-tag mt-1">{year}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="green-gradient rounded-3xl px-8 py-14 text-center text-white relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "radial-gradient(circle at 70% 30%, white 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <h2 className="dm-serif text-3xl md:text-4xl mb-4 relative">
            Ready to Build Your Future?
          </h2>
          <p className="text-white/80 mb-8 max-w-lg mx-auto relative">
            Join 3,200+ Strathmore alumni and students building careers, sharing
            knowledge, and lifting each other up.
          </p>
          <div className="flex flex-wrap gap-3 justify-center relative">
            <Btn
              variant="gold"
              size="lg"
              onClick={() => setPage("student-dashboard")}
            >
              Get Started as Student
            </Btn>
            <button
              className="px-7 py-3.5 text-base font-semibold rounded-xl border-2 border-white/40 text-white hover:bg-white/10 transition-colors cursor-pointer"
              onClick={() => setPage("alumni-dashboard")}
            >
              Join as Alumni
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ─── Alumni Profile Page ──────────────────────────────────────────────────────
function AlumniProfilePage({ setPage }: { setPage: (p: Page) => void }) {
  const a = alumni[0]
  const [tab, setTab] = useState<"overview" | "experience" | "opportunities">(
    "overview",
  )
  const [following, setFollowing] = useState(false)

  const timeline = [
    {
      year: "2020–Present",
      role: "Senior Data Scientist",
      company: "Google DeepMind",
      desc: "Leading ML research on NLP systems for African languages.",
    },
    {
      year: "2017–2020",
      role: "Data Scientist",
      company: "Safaricom",
      desc: "Built predictive models for M-PESA fraud detection, saving $2M annually.",
    },
    {
      year: "2014–2017",
      role: "Research Assistant",
      company: "Strathmore University",
      desc: "Conducted research on machine learning applications in healthcare.",
    },
    {
      year: "2010–2014",
      role: "BSc. Computer Science",
      company: "Strathmore University",
      desc: "Graduated First Class Honours. Final project: Swahili NLP toolkit.",
    },
  ]

  return (
    <div className="fade-in">
      {/* Cover */}
      <div className="relative h-48 md:h-60 bg-gradient-to-r from-[#0B6B3A] to-[#0E8A4A]">
        <img
          src={a.cover}
          alt=""
          className="w-full h-full object-cover opacity-40"
        />
        <button
          className="absolute top-4 left-4 md:left-8 text-white/80 hover:text-white flex items-center gap-1 text-sm"
          onClick={() => setPage("landing")}
        >
          ← Back to Search
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Profile header */}
        <div className="relative -mt-16 mb-6">
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="relative flex-shrink-0">
                <img
                  src={a.img}
                  alt={a.name}
                  className="w-24 h-24 rounded-2xl border-4 border-white shadow-md object-cover"
                  style={{ border: "4px solid white" }}
                />
                <span
                  className="badge-online"
                  style={{ bottom: 4, right: 4 }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-start gap-3 justify-between">
                  <div>
                    <h1 className="dm-serif text-2xl text-[#0F1A14]">
                      {a.name}
                    </h1>
                    <p className="text-[#5A7263] font-medium">
                      {a.role} · {a.company}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-sm text-[#5A7263]">
                      <span className="flex items-center gap-1">
                        <Icon.MapPin />
                        {a.location}
                      </span>
                      <span>·</span>
                      <span>{a.year}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn
                      variant="primary"
                      size="sm"
                      onClick={() => setPage("messaging")}
                    >
                      <Icon.MessageCircle /> Message
                    </Btn>
                    <Btn variant="gold" size="sm">
                      <Icon.Calendar /> Book Session
                    </Btn>
                    <Btn
                      variant={following ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setFollowing(!following)}
                    >
                      <Icon.Heart /> {following ? "Following" : "Follow"}
                    </Btn>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {a.areas.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                  <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                    <span className="availability-dot" />
                    Available for Mentoring
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-[#D6E4DA]">
              {[
                ["128", "Students Mentored"],
                ["4.9 ★", "Rating"],
                ["12", "Yrs Experience"],
              ].map(([val, lbl]) => (
                <div key={lbl} className="text-center">
                  <p className="font-bold text-[#0B6B3A] text-lg">{val}</p>
                  <p className="text-xs text-[#5A7263]">{lbl}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#D6E4DA] p-1 shadow-sm">
          {(["overview", "experience", "opportunities"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium capitalize transition-colors cursor-pointer ${
                tab === t
                  ? "bg-[#0B6B3A] text-white shadow-sm"
                  : "text-[#5A7263] hover:text-[#0F1A14]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-6 pb-16">
          <div className="md:col-span-2 space-y-5">
            {tab === "overview" && (
              <>
                <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6">
                  <h3 className="font-semibold text-[#0F1A14] mb-3 flex items-center gap-2">
                    <Icon.User />
                    About
                  </h3>
                  <p className="text-[#5A7263] text-sm leading-relaxed">
                    {a.bio} With over 12 years in the industry, I have mentored
                    over 128 students from Strathmore, helping them secure
                    positions at top companies in Kenya, Nigeria, and globally.
                  </p>
                </div>

                <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6">
                  <h3 className="font-semibold text-[#0F1A14] mb-4 flex items-center gap-2">
                    <Icon.TrendingUp />
                    Career Journey
                  </h3>
                  <div className="relative pl-5 space-y-5">
                    <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#D6E4DA]" />
                    {timeline.map(({ year, role, company, desc }, i) => (
                      <div key={i} className="relative">
                        <div className="timeline-dot absolute -left-7 top-1" />
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <p className="text-xs text-[#D4A017] font-semibold">
                              {year}
                            </p>
                            <p className="font-semibold text-[#0F1A14] text-sm">
                              {role}
                            </p>
                            <p className="text-xs text-[#0B6B3A] font-medium">
                              {company}
                            </p>
                            <p className="text-xs text-[#5A7263] mt-1">
                              {desc}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6">
                  <h3 className="font-semibold text-[#0F1A14] mb-3 flex items-center gap-2">
                    <Icon.BookOpen />
                    Career Advice
                  </h3>
                  <div className="space-y-3">
                    {[
                      "Master the fundamentals of statistics and linear algebra before jumping into ML frameworks.",
                      "Build a GitHub portfolio with real projects. Recruiters at top companies look at this first.",
                      "Network early and often. The Strathmore alumni community is one of Kenya's strongest.",
                    ].map((tip, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <div className="w-6 h-6 rounded-full bg-[#E8F4EE] text-[#0B6B3A] flex items-center justify-center flex-shrink-0 text-xs font-bold">
                          {i + 1}
                        </div>
                        <p className="text-sm text-[#5A7263]">{tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === "experience" && (
              <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6">
                <h3 className="font-semibold text-[#0F1A14] mb-4">
                  Skills & Expertise
                </h3>
                <div className="flex flex-wrap gap-2 mb-6">
                  {[
                    "Python",
                    "TensorFlow",
                    "PyTorch",
                    "NLP",
                    "Machine Learning",
                    "Data Analysis",
                    "SQL",
                    "Google Cloud",
                    "BigQuery",
                    "Swahili NLP",
                    "Research",
                    "Team Leadership",
                  ].map((s) => (
                    <span key={s} className="tag">
                      {s}
                    </span>
                  ))}
                </div>
                <h3 className="font-semibold text-[#0F1A14] mb-4">
                  Certifications
                </h3>
                <div className="space-y-3">
                  {[
                    {
                      name: "Google Professional ML Engineer",
                      issuer: "Google Cloud",
                      year: "2023",
                    },
                    {
                      name: "Deep Learning Specialization",
                      issuer: "Coursera / DeepLearning.AI",
                      year: "2021",
                    },
                    {
                      name: "PhD Artificial Intelligence",
                      issuer: "University of Cape Town",
                      year: "2019",
                    },
                  ].map(({ name, issuer, year }) => (
                    <div
                      key={name}
                      className="flex items-center gap-3 p-3 bg-[#F7F9F7] rounded-xl"
                    >
                      <div className="w-9 h-9 rounded-lg bg-[#E8F4EE] text-[#0B6B3A] flex items-center justify-center">
                        <Icon.Award />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#0F1A14]">
                          {name}
                        </p>
                        <p className="text-xs text-[#5A7263]">
                          {issuer} · {year}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "opportunities" && (
              <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6">
                <h3 className="font-semibold text-[#0F1A14] mb-4">
                  Posted Opportunities
                </h3>
                <div className="space-y-4">
                  {[
                    {
                      title: "ML Engineer Intern",
                      type: "Internship",
                      location: "Nairobi (Hybrid)",
                      deadline: "Sep 30, 2026",
                    },
                    {
                      title: "Data Scientist Graduate",
                      type: "Full-time",
                      location: "London, UK",
                      deadline: "Oct 15, 2026",
                    },
                  ].map(({ title, type, location, deadline }) => (
                    <div
                      key={title}
                      className="border border-[#D6E4DA] rounded-xl p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[#0F1A14]">
                            {title}
                          </p>
                          <p className="text-sm text-[#5A7263]">
                            Google DeepMind · {location}
                          </p>
                          <div className="flex gap-2 mt-2">
                            <span className="tag">{type}</span>
                            <span className="text-xs text-[#5A7263]">
                              Deadline: {deadline}
                            </span>
                          </div>
                        </div>
                        <Btn variant="primary" size="sm">
                          Apply
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5">
              <h3 className="font-semibold text-[#0F1A14] mb-3 text-sm">
                Mentorship Areas
              </h3>
              <div className="flex flex-wrap gap-2">
                {[
                  "Machine Learning",
                  "Data Science",
                  "Career Growth",
                  "Interview Prep",
                  "Research",
                  "Networking",
                ].map((s) => (
                  <span key={s} className="tag">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5">
              <h3 className="font-semibold text-[#0F1A14] mb-3 text-sm">
                Availability
              </h3>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <div
                    key={i}
                    className="text-center text-xs text-[#5A7263] font-medium"
                  >
                    {d}
                  </div>
                ))}
                {[
                  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
                  19, 20, 21,
                ].map((d) => (
                  <div
                    key={d}
                    className={`text-center text-xs rounded py-1 cursor-pointer transition-colors ${
                      [2, 4, 9, 11, 16, 18].includes(d)
                        ? "bg-[#0B6B3A] text-white font-medium"
                        : [1, 7, 8, 14, 15, 21].includes(d)
                          ? "text-[#D6E4DA]"
                          : "hover:bg-[#F0F4F1] text-[#0F1A14]"
                    }`}
                  >
                    {d}
                  </div>
                ))}
              </div>
              <p className="text-xs text-[#5A7263] text-center">
                Green = available slots
              </p>
              <Btn variant="gold" size="sm" className="w-full mt-3">
                Book a Session
              </Btn>
            </div>

            <div className="bg-[#E8F4EE] rounded-2xl p-5 border border-[#0B6B3A]/20">
              <h3 className="font-semibold text-[#0B6B3A] text-sm mb-1">
                Success Highlight
              </h3>
              <p className="text-xs text-[#5A7263] leading-relaxed">
                "Dr. Amina helped me prepare for Google interviews. 3 months
                later I joined as an SWE." —{" "}
                <strong>Kevin O., Class of 2023</strong>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Student Dashboard ────────────────────────────────────────────────────────
function StudentDashboard({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-[#5A7263] text-sm">Good morning,</p>
          <h1 className="dm-serif text-2xl text-[#0F1A14]">Kevin Otieno 👋</h1>
          <p className="text-sm text-[#5A7263] mt-1">
            BSc. Computer Science · 3rd Year · Student ID: STR2023047
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-xl border border-[#D6E4DA] bg-white text-[#5A7263] relative">
            <Icon.Bell />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>
          <img
            src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&auto=format"
            alt="Profile"
            className="w-10 h-10 rounded-full object-cover border-2 border-[#D6E4DA]"
          />
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          {
            icon: <Icon.Search />,
            label: "Search Alumni",
            color: "#0B6B3A",
            bg: "#E8F4EE",
            action: () => setPage("landing"),
          },
          {
            icon: <Icon.MessageCircle />,
            label: "Ask Career Question",
            color: "#D4A017",
            bg: "#FDF7E5",
            action: () => setPage("messaging"),
          },
          {
            icon: <Icon.Upload />,
            label: "Upload CV",
            color: "#7C3AED",
            bg: "#F3EEFF",
            action: () => {},
          },
          {
            icon: <Icon.Calendar />,
            label: "View Events",
            color: "#0891B2",
            bg: "#E0F7FA",
            action: () => setPage("events"),
          },
        ].map(({ icon, label, color, bg, action }) => (
          <button
            key={label}
            onClick={action}
            className="bg-white rounded-2xl border border-[#D6E4DA] p-4 flex flex-col items-start gap-3 card-hover cursor-pointer text-left"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: bg, color }}
            >
              {icon}
            </div>
            <p className="text-sm font-semibold text-[#0F1A14] leading-tight">
              {label}
            </p>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Main col */}
        <div className="md:col-span-2 space-y-6">
          {/* Upcoming sessions */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[#0F1A14] flex items-center gap-2">
                <Icon.Calendar />
                Upcoming Sessions
              </h2>
              <span className="text-xs bg-[#0B6B3A] text-white px-2 py-0.5 rounded-full">
                2 this week
              </span>
            </div>
            <div className="space-y-3">
              {[
                {
                  mentor: "Dr. Amina Osei",
                  topic: "ML Career Roadmap",
                  date: "Thu, Aug 14 · 7:00 PM",
                  img: alumni[0].img,
                },
                {
                  mentor: "Grace Njoroge",
                  topic: "Portfolio Review",
                  date: "Fri, Aug 15 · 5:30 PM",
                  img: alumni[4].img,
                },
              ].map(({ mentor, topic, date, img }) => (
                <div
                  key={mentor}
                  className="flex items-center gap-3 p-3 bg-[#F7F9F7] rounded-xl"
                >
                  <img
                    src={img}
                    alt={mentor}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#0F1A14] text-sm">
                      {mentor}
                    </p>
                    <p className="text-xs text-[#5A7263]">
                      {topic} · {date}
                    </p>
                  </div>
                  <Btn variant="primary" size="sm">
                    Join
                  </Btn>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended mentors */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[#0F1A14] flex items-center gap-2">
                <Icon.Users />
                Recommended Mentors
              </h2>
              <button
                className="text-xs text-[#0B6B3A] font-medium hover:underline"
                onClick={() => setPage("landing")}
              >
                View All
              </button>
            </div>
            <div className="space-y-3">
              {alumni.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center gap-3">
                  <div className="relative">
                    <img
                      src={a.img}
                      alt={a.name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    {a.available && <span className="badge-online" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#0F1A14] text-sm">
                      {a.name}
                    </p>
                    <p className="text-xs text-[#5A7263] truncate">
                      {a.role} · {a.company}
                    </p>
                  </div>
                  <Btn
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage("alumni-profile")}
                  >
                    View
                  </Btn>
                </div>
              ))}
            </div>
          </div>

          {/* Career resources */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <h2 className="font-semibold text-[#0F1A14] mb-4 flex items-center gap-2">
              <Icon.BookOpen />
              Career Resources
            </h2>
            <div className="space-y-2">
              {[
                {
                  title: "How to Build a Strong LinkedIn Profile",
                  type: "Article",
                  time: "5 min read",
                },
                {
                  title: "Negotiating Your First Salary",
                  type: "Webinar",
                  time: "45 min",
                },
                {
                  title: "Technical Interview Prep Guide",
                  type: "Guide",
                  time: "PDF, 32 pages",
                },
                {
                  title: "Graduate CV Template 2026",
                  type: "Template",
                  time: "Downloadable",
                },
              ].map(({ title, type, time }) => (
                <div
                  key={title}
                  className="flex items-center gap-3 p-3 hover:bg-[#F7F9F7] rounded-xl cursor-pointer transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#E8F4EE] text-[#0B6B3A] flex items-center justify-center flex-shrink-0 text-xs font-bold">
                    {type[0]}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#0F1A14]">
                      {title}
                    </p>
                    <p className="text-xs text-[#5A7263]">
                      {type} · {time}
                    </p>
                  </div>
                  <Icon.ChevronRight />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Saved mentors */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <h2 className="font-semibold text-[#0F1A14] mb-3 text-sm flex items-center gap-2">
              <Icon.Heart />
              Saved Mentors
            </h2>
            <div className="space-y-3">
              {alumni.slice(1, 4).map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <img
                    src={a.img}
                    alt={a.name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0F1A14] truncate">
                      {a.name}
                    </p>
                    <p className="text-xs text-[#5A7263] truncate">
                      {a.company}
                    </p>
                  </div>
                  <button className="text-[#D4A017]">
                    <Icon.Heart />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <h2 className="font-semibold text-[#0F1A14] mb-3 text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Icon.Bell />
                Notifications
              </span>
              <span className="w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                3
              </span>
            </h2>
            <div className="space-y-3">
              {[
                {
                  msg: "Dr. Amina confirmed your Thursday session",
                  time: "2h ago",
                  dot: "bg-[#0B6B3A]",
                },
                {
                  msg: "New job posting: ML Intern at Safaricom",
                  time: "5h ago",
                  dot: "bg-[#D4A017]",
                },
                {
                  msg: "Career Fair 2026 registration is open",
                  time: "1d ago",
                  dot: "bg-[#0891B2]",
                },
              ].map(({ msg, time, dot }) => (
                <div key={msg} className="flex gap-2 items-start">
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dot}`}
                  />
                  <div>
                    <p className="text-xs text-[#0F1A14]">{msg}</p>
                    <p className="text-xs text-[#5A7263]">{time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming event */}
          <div className="bg-gradient-to-br from-[#0B6B3A] to-[#0E8A4A] rounded-2xl p-5 text-white">
            <p className="text-white/70 text-xs font-medium mb-1">
              UPCOMING EVENT
            </p>
            <h3 className="font-bold text-sm mb-1">Tech Career Fair 2026</h3>
            <p className="text-white/80 text-xs mb-3">
              Sep 5 · 9 AM – 4 PM · Hybrid
            </p>
            <Btn
              variant="gold"
              size="sm"
              className="w-full"
              onClick={() => setPage("events")}
            >
              Register Now
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Alumni Dashboard ─────────────────────────────────────────────────────────
function AlumniDashboard({ setPage }: { setPage: (p: Page) => void }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-[#5A7263] text-sm">Welcome back,</p>
          <h1 className="dm-serif text-2xl text-[#0F1A14]">Dr. Amina Osei</h1>
          <p className="text-sm text-[#5A7263] mt-1">
            Senior Data Scientist · Google DeepMind · Class of 2014
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="primary" size="sm">
            <Icon.Plus />
            Post Opportunity
          </Btn>
          <img
            src={alumni[0].img}
            alt="Profile"
            className="w-10 h-10 rounded-full object-cover border-2 border-[#D6E4DA]"
          />
        </div>
      </div>

      {/* Profile completion */}
      <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 mb-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-[#0F1A14] text-sm">
              Profile Completion
            </h2>
            <p className="text-xs text-[#5A7263]">
              Complete your profile to attract more students
            </p>
          </div>
          <span className="text-2xl font-bold text-[#0B6B3A]">85%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: "85%" }} />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {[
            { label: "Add availability calendar", done: false },
            { label: "Upload profile photo", done: true },
            { label: "Add career timeline", done: true },
            { label: "Set mentorship areas", done: true },
            { label: "Connect LinkedIn", done: false },
          ].map(({ label, done }) => (
            <span
              key={label}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                done
                  ? "bg-[#E8F4EE] text-[#0B6B3A]"
                  : "bg-[#FDF7E5] text-[#92690A]"
              }`}
            >
              {done ? "✓" : "○"} {label}
            </span>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          {
            val: "128",
            label: "Students Mentored",
            icon: <Icon.Users />,
            color: "#0B6B3A",
          },
          {
            val: "24",
            label: "Sessions This Month",
            icon: <Icon.Calendar />,
            color: "#D4A017",
          },
          {
            val: "8",
            label: "Pending Requests",
            icon: <Icon.Bell />,
            color: "#7C3AED",
          },
          {
            val: "3",
            label: "Jobs Posted",
            icon: <Icon.Briefcase />,
            color: "#0891B2",
          },
        ].map(({ val, label, icon, color }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: `${color}18`, color }}
              >
                {icon}
              </div>
            </div>
            <p className="text-2xl font-bold" style={{ color }}>
              {val}
            </p>
            <p className="text-xs text-[#5A7263] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {/* Mentorship requests */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[#0F1A14]">
                Mentorship Requests
              </h2>
              <span className="text-xs bg-[#D4A017] text-white px-2 py-0.5 rounded-full font-medium">
                8 new
              </span>
            </div>
            <div className="space-y-3">
              {[
                {
                  name: "Kevin Otieno",
                  course: "BSc. Computer Science · Y3",
                  topic: "Machine Learning career path",
                  img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&auto=format",
                },
                {
                  name: "Mercy Wanjiku",
                  course: "BSc. Statistics · Y4",
                  topic: "Data science internship guidance",
                  img: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=40&h=40&fit=crop&auto=format",
                },
                {
                  name: "David Kamau",
                  course: "MSc. AI · Y1",
                  topic: "Research opportunities at DeepMind",
                  img: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=40&h=40&fit=crop&auto=format",
                },
              ].map(({ name, course, topic, img }) => (
                <div
                  key={name}
                  className="flex items-center gap-3 p-3 bg-[#F7F9F7] rounded-xl"
                >
                  <img
                    src={img}
                    alt={name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#0F1A14] text-sm">
                      {name}
                    </p>
                    <p className="text-xs text-[#5A7263]">{course}</p>
                    <p className="text-xs text-[#0B6B3A] font-medium mt-0.5">
                      "{topic}"
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Btn variant="primary" size="sm">
                      Accept
                    </Btn>
                    <Btn variant="outline" size="sm">
                      Decline
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Alumni discussions */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <h2 className="font-semibold text-[#0F1A14] mb-4">
              Group Discussions
            </h2>
            <div className="space-y-3">
              {[
                {
                  group: "School of Computing",
                  msg: "James Mwangi: 'Any alumni interested in speaking at the Sept Career Fair?'",
                  time: "20 min ago",
                },
                {
                  group: "Class of 2014",
                  msg: "Faith Kimani: 'Reunion planning — save the date: Oct 15!'",
                  time: "2 hours ago",
                },
                {
                  group: "Women in Leadership",
                  msg: "Grace Njoroge: 'Sharing new mentorship toolkit resources'",
                  time: "1 day ago",
                },
              ].map(({ group, msg, time }) => (
                <div
                  key={group}
                  className="p-3 hover:bg-[#F7F9F7] rounded-xl cursor-pointer transition-colors"
                >
                  <div className="flex justify-between items-start mb-1">
                    <p className="text-sm font-semibold text-[#0B6B3A]">
                      {group}
                    </p>
                    <span className="text-xs text-[#5A7263]">{time}</span>
                  </div>
                  <p className="text-xs text-[#5A7263]">{msg}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Give back */}
          <div className="bg-gradient-to-br from-[#0B6B3A] to-[#094F2B] rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <Icon.Heart />
              <h2 className="font-semibold text-sm">Give Back to Strathmore</h2>
            </div>
            <div className="space-y-2">
              {[
                { label: "Volunteer as Mentor", icon: "🎓" },
                { label: "Speak at an Event", icon: "🎤" },
                { label: "Offer Internship", icon: "💼" },
                { label: "Donate / Support", icon: "❤️" },
              ].map(({ label, icon }) => (
                <button
                  key={label}
                  className="w-full text-left text-sm bg-white/10 hover:bg-white/20 transition-colors px-3 py-2.5 rounded-xl flex items-center gap-3 cursor-pointer"
                >
                  <span>{icon}</span> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Upcoming sessions */}
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
            <h2 className="font-semibold text-[#0F1A14] mb-3 text-sm flex items-center gap-2">
              <Icon.Calendar />
              Upcoming Sessions
            </h2>
            <div className="space-y-2">
              {[
                { name: "Kevin Otieno", date: "Thu, Aug 14 · 7 PM" },
                { name: "Mercy Wanjiku", date: "Sat, Aug 16 · 11 AM" },
              ].map(({ name, date }) => (
                <div
                  key={name}
                  className="p-2.5 bg-[#F7F9F7] rounded-xl text-sm"
                >
                  <p className="font-medium text-[#0F1A14]">{name}</p>
                  <p className="text-xs text-[#5A7263]">{date}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Announcement */}
          <div className="bg-[#FDF7E5] rounded-2xl p-5 border border-[#D4A017]/30">
            <p className="text-xs font-semibold text-[#92690A] mb-1">
              SCHOOL ANNOUNCEMENT
            </p>
            <p className="text-sm text-[#0F1A14] font-medium">
              Annual Gala: Oct 15, 2026
            </p>
            <p className="text-xs text-[#5A7263] mt-1">
              You're invited to the Annual Alumni Gala. RSVP by Sep 30.
            </p>
            <Btn
              variant="gold"
              size="sm"
              className="mt-3 w-full"
              onClick={() => setPage("events")}
            >
              RSVP Now
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Events Page ──────────────────────────────────────────────────────────────
function EventsPage() {
  const [filter, setFilter] = useState("All")
  const filters = ["All", "In-Person", "Online", "Hybrid"]
  const filtered =
    filter === "All" ? events : events.filter((e) => e.type === filter)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 pb-24 md:pb-10 fade-in">
      <div className="mb-8">
        <h1 className="dm-serif text-3xl text-[#0F1A14] mb-2">
          Events & Opportunities
        </h1>
        <p className="text-[#5A7263]">
          Reunions, career fairs, webinars, and networking events for the
          Strathmore community
        </p>
      </div>

      {/* Featured event hero */}
      <div className="relative rounded-3xl overflow-hidden mb-8 h-56 md:h-72">
        <img
          src="https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&h=400&fit=crop&auto=format"
          alt="Annual Gala"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 p-6 text-white">
          <span className="text-xs bg-[#D4A017] text-white px-2.5 py-1 rounded-full font-semibold mb-2 inline-block">
            FEATURED
          </span>
          <h2 className="dm-serif text-2xl md:text-3xl mb-1">
            Annual Alumni Gala 2026
          </h2>
          <p className="text-white/80 text-sm mb-3">
            October 15 · 6 PM · Strathmore University Main Hall
          </p>
          <Btn variant="gold" size="md">
            Register Now
          </Btn>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              filter === f
                ? "bg-[#0B6B3A] text-white"
                : "bg-white border border-[#D6E4DA] text-[#5A7263] hover:bg-[#F0F4F1]"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-5">
        {filtered.map((ev) => (
          <div
            key={ev.id}
            className="bg-white rounded-2xl border border-[#D6E4DA] overflow-hidden card-hover"
          >
            <div className="h-44 overflow-hidden relative">
              <img
                src={ev.img}
                alt={ev.title}
                className="w-full h-full object-cover"
              />
              <span
                className={`absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  ev.type === "Online"
                    ? "bg-blue-100 text-blue-700"
                    : ev.type === "Hybrid"
                      ? "bg-purple-100 text-purple-700"
                      : "bg-green-100 text-green-700"
                }`}
              >
                {ev.type}
              </span>
              <span className="absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full bg-[#D4A017] text-white">
                {ev.tag}
              </span>
            </div>
            <div className="p-5">
              <h3 className="font-semibold text-[#0F1A14] text-base mb-2">
                {ev.title}
              </h3>
              <div className="flex items-center gap-1 text-xs text-[#5A7263] mb-1">
                <Icon.Calendar />
                <span>
                  {ev.date} · {ev.time}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-[#5A7263] mb-3">
                <Icon.MapPin />
                <span>{ev.location}</span>
              </div>
              <p className="text-sm text-[#5A7263] leading-relaxed mb-4">
                {ev.desc}
              </p>
              <Btn variant="primary" size="sm" className="w-full">
                Register
              </Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Messaging ────────────────────────────────────────────────────────────────
function MessagingPage() {
  const [selected, setSelected] = useState(0)
  const [input, setInput] = useState("")
  const [allMessages, setAllMessages] = useState(messages)

  function send() {
    if (!input.trim()) return
    setAllMessages((m) => [
      ...m,
      { id: m.length + 1, from: "me", text: input.trim(), time: "Now" },
    ])
    setInput("")
  }

  const conv = conversations[selected]

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-6 fade-in">
      <h1 className="dm-serif text-2xl text-[#0F1A14] mb-5 md:hidden">
        Messages
      </h1>
      <div
        className="bg-white rounded-2xl border border-[#D6E4DA] shadow-sm overflow-hidden"
        style={{ height: "calc(100vh - 180px)", minHeight: 520 }}
      >
        <div className="flex h-full">
          {/* Conversation list */}
          <div className="w-72 flex-shrink-0 border-r border-[#D6E4DA] flex flex-col hidden sm:flex">
            <div className="p-4 border-b border-[#D6E4DA]">
              <h2 className="font-semibold text-[#0F1A14] mb-3">Messages</h2>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A7263]">
                  <Icon.Search />
                </div>
                <input
                  placeholder="Search conversations..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-[#D6E4DA] bg-[#F7F9F7]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(i)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#F7F9F7] transition-colors text-left ${
                    i === selected
                      ? "bg-[#E8F4EE] border-r-2 border-[#0B6B3A]"
                      : ""
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <img
                      src={c.img}
                      alt={c.name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    {c.online && <span className="badge-online" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <p className="font-semibold text-[#0F1A14] text-sm">
                        {c.name}
                      </p>
                      <span className="text-xs text-[#5A7263]">{c.time}</span>
                    </div>
                    <p className="text-xs text-[#5A7263] truncate">
                      {c.preview}
                    </p>
                  </div>
                  {c.unread > 0 && (
                    <span className="w-5 h-5 bg-[#0B6B3A] text-white text-xs rounded-full flex items-center justify-center font-bold flex-shrink-0">
                      {c.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Chat header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#D6E4DA]">
              <div className="relative">
                <img
                  src={conv.img}
                  alt={conv.name}
                  className="w-10 h-10 rounded-full object-cover"
                />
                {conv.online && <span className="badge-online" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-[#0F1A14]">{conv.name}</p>
                <p className="text-xs text-[#5A7263]">
                  {conv.online ? "Online now" : "Last seen yesterday"}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="p-2 rounded-xl hover:bg-[#F0F4F1] text-[#5A7263]">
                  <Icon.Video />
                </button>
                <button className="p-2 rounded-xl hover:bg-[#F0F4F1] text-[#5A7263]">
                  <Icon.Calendar />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="text-center text-xs text-[#5A7263] bg-[#F0F4F1] rounded-full px-3 py-1 w-fit mx-auto">
                Today, August 9
              </div>
              {allMessages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${
                    m.from === "me" ? "justify-end" : "justify-start"
                  } gap-3`}
                >
                  {m.from !== "me" && (
                    <img
                      src={conv.img}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0 self-end"
                    />
                  )}
                  <div
                    className={`max-w-xs md:max-w-sm ${
                      m.from === "me"
                        ? "message-bubble-sent"
                        : "message-bubble-received"
                    } px-4 py-2.5`}
                  >
                    <p className="text-sm leading-relaxed">{m.text}</p>
                    <p
                      className={`text-xs mt-1 ${
                        m.from === "me" ? "text-white/60" : "text-[#5A7263]"
                      }`}
                    >
                      {m.time}
                    </p>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs text-[#5A7263]">
                <img
                  src={conv.img}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover"
                />
                <span className="bg-[#F0F4F1] rounded-full px-3 py-1.5">
                  typing...
                </span>
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-[#D6E4DA] p-4">
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-xl hover:bg-[#F0F4F1] text-[#5A7263] flex-shrink-0">
                  <Icon.Paperclip />
                </button>
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#D6E4DA] bg-[#F7F9F7] text-sm"
                />
                <button
                  onClick={send}
                  disabled={!input.trim()}
                  className="p-2.5 rounded-xl bg-[#0B6B3A] text-white flex-shrink-0 hover:bg-[#094F2B] disabled:opacity-40 transition-colors"
                >
                  <Icon.Send />
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                {["Schedule a meeting", "Share my CV", "Thanks!"].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="text-xs bg-[#F0F4F1] text-[#5A7263] px-3 py-1 rounded-full hover:bg-[#E8F4EE] hover:text-[#0B6B3A] transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Communities ──────────────────────────────────────────────────────────────
function CommunitiesPage() {
  const [joined, setJoined] = useState<number[]>([2])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 pb-24 md:pb-10 fade-in">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="dm-serif text-3xl text-[#0F1A14] mb-2">
            Alumni Communities
          </h1>
          <p className="text-[#5A7263]">
            Join groups organized by class year, school, industry, and location
          </p>
        </div>
        <Btn variant="primary">
          <Icon.Plus />
          Create Group
        </Btn>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {communities.map((c) => {
          const isJoined = joined.includes(c.id)
          return (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-[#D6E4DA] overflow-hidden card-hover"
            >
              <div className="h-36 overflow-hidden">
                <img
                  src={c.img}
                  alt={c.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-[#0F1A14] text-base mb-1">
                  {c.name}
                </h3>
                <p className="text-xs text-[#5A7263] mb-2">{c.desc}</p>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs text-[#5A7263] flex items-center gap-1">
                    <Icon.Users />
                    {c.members.toLocaleString()} members
                  </span>
                  <span className="text-xs text-[#0B6B3A] font-medium">
                    {c.activity}
                  </span>
                </div>
                <Btn
                  variant={isJoined ? "secondary" : "primary"}
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    setJoined((j) =>
                      isJoined ? j.filter((x) => x !== c.id) : [...j, c.id],
                    )
                  }
                >
                  {isJoined ? "✓ Joined" : "Join Group"}
                </Btn>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel() {
  const barData = [
    { month: "Mar", val: 42 },
    { month: "Apr", val: 58 },
    { month: "May", val: 47 },
    { month: "Jun", val: 72 },
    { month: "Jul", val: 65 },
    { month: "Aug", val: 89 },
  ]
  const maxVal = Math.max(...barData.map((d) => d.val))
  const [tab, setTab] = useState<"overview" | "alumni" | "announcements">(
    "overview",
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-xs font-semibold text-[#D4A017] uppercase tracking-wider mb-1">
            Admin Dashboard
          </p>
          <h1 className="dm-serif text-2xl text-[#0F1A14]">
            Strathmore Alumni Connect
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-xl border border-[#D6E4DA] bg-white text-[#5A7263]">
            <Icon.Bell />
          </button>
          <button className="p-2 rounded-xl border border-[#D6E4DA] bg-white text-[#5A7263]">
            <Icon.Settings />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          {
            val: "3,247",
            label: "Total Alumni",
            change: "+48 this month",
            color: "#0B6B3A",
            bg: "#E8F4EE",
          },
          {
            val: "427",
            label: "Active Mentors",
            change: "+12 this month",
            color: "#D4A017",
            bg: "#FDF7E5",
          },
          {
            val: "89",
            label: "Mentorship Requests",
            change: "24 pending review",
            color: "#7C3AED",
            bg: "#F3EEFF",
          },
          {
            val: "4",
            label: "Upcoming Events",
            change: "Next: Aug 22",
            color: "#0891B2",
            bg: "#E0F7FA",
          },
        ].map(({ val, label, change, color, bg }) => (
          <div key={label} className="stat-card">
            <p className="text-2xl font-bold mb-1" style={{ color }}>
              {val}
            </p>
            <p className="text-sm font-semibold text-[#0F1A14]">{label}</p>
            <p
              className="text-xs mt-1 px-2 py-0.5 rounded-full w-fit"
              style={{ background: bg, color }}
            >
              {change}
            </p>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#D6E4DA] p-1 shadow-sm w-fit">
        {(["overview", "alumni", "announcements"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors cursor-pointer ${
              tab === t
                ? "bg-[#0B6B3A] text-white"
                : "text-[#5A7263] hover:text-[#0F1A14]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            {/* Chart */}
            <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[#0F1A14]">
                  Mentorship Sessions
                </h2>
                <span className="text-xs text-[#0B6B3A] font-medium bg-[#E8F4EE] px-2 py-1 rounded-full">
                  +23% vs last quarter
                </span>
              </div>
              <div className="flex items-end gap-3 h-40">
                {barData.map(({ month, val }) => (
                  <div
                    key={month}
                    className="flex-1 flex flex-col items-center gap-2"
                  >
                    <span className="text-xs font-semibold text-[#0B6B3A]">
                      {val}
                    </span>
                    <div
                      className="w-full chart-bar"
                      style={{ height: `${(val / maxVal) * 100}px` }}
                    />
                    <span className="text-xs text-[#5A7263]">{month}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Verification queue */}
            <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[#0F1A14]">
                  Alumni Verification Queue
                </h2>
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                  7 pending
                </span>
              </div>
              <div className="space-y-3">
                {[
                  {
                    name: "Samuel Njuguna",
                    year: "Class of 2018",
                    status: "Pending",
                    course: "BSc. Finance",
                  },
                  {
                    name: "Wanjiru Kamau",
                    year: "Class of 2020",
                    status: "Pending",
                    course: "BSc. Information Technology",
                  },
                  {
                    name: "Peter Omondi",
                    year: "Class of 2016",
                    status: "Reviewing",
                    course: "MBA",
                  },
                ].map(({ name, year, status, course }) => (
                  <div
                    key={name}
                    className="flex items-center gap-3 p-3 border border-[#D6E4DA] rounded-xl"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0B6B3A] to-[#0E8A4A] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#0F1A14] text-sm">
                        {name}
                      </p>
                      <p className="text-xs text-[#5A7263]">
                        {course} · {year}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        status === "Pending"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {status}
                    </span>
                    <div className="flex gap-1">
                      <Btn variant="primary" size="sm">
                        Verify
                      </Btn>
                      <Btn variant="outline" size="sm">
                        Reject
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {/* Engagement */}
            <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
              <h2 className="font-semibold text-[#0F1A14] mb-4 text-sm">
                Engagement Analytics
              </h2>
              <div className="space-y-3">
                {[
                  { label: "Profile Views", val: 1842, pct: 78 },
                  { label: "Mentorship Matches", val: 312, pct: 62 },
                  { label: "Event Registrations", val: 567, pct: 85 },
                  { label: "Community Posts", val: 234, pct: 45 },
                ].map(({ label, val, pct }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#0F1A14] font-medium">
                        {label}
                      </span>
                      <span className="text-[#0B6B3A] font-semibold">
                        {val.toLocaleString()}
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick actions */}
            <div className="bg-white rounded-2xl border border-[#D6E4DA] p-5 shadow-sm">
              <h2 className="font-semibold text-[#0F1A14] mb-3 text-sm">
                Quick Actions
              </h2>
              <div className="space-y-2">
                {[
                  { label: "Send Announcement", icon: <Icon.Bell /> },
                  { label: "Export Alumni List", icon: <Icon.Upload /> },
                  { label: "View Analytics Report", icon: <Icon.BarChart2 /> },
                  { label: "Manage Events", icon: <Icon.Calendar /> },
                ].map(({ label, icon }) => (
                  <button
                    key={label}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-[#0F1A14] hover:bg-[#F0F4F1] rounded-xl transition-colors text-left cursor-pointer"
                  >
                    <span className="text-[#0B6B3A]">{icon}</span>
                    {label}
                    <Icon.ChevronRight />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "alumni" && (
        <div className="bg-white rounded-2xl border border-[#D6E4DA] overflow-hidden shadow-sm">
          <div className="p-5 border-b border-[#D6E4DA] flex items-center justify-between">
            <h2 className="font-semibold text-[#0F1A14]">Alumni Directory</h2>
            <div className="flex gap-2">
              <input
                placeholder="Search alumni..."
                className="px-3 py-2 text-sm border border-[#D6E4DA] rounded-xl bg-[#F7F9F7] w-48"
              />
              <Btn variant="primary" size="sm">
                <Icon.Plus />
                Add Alumni
              </Btn>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#D6E4DA] bg-[#F7F9F7]">
                  {[
                    "Name",
                    "Class Year",
                    "Company",
                    "Industry",
                    "Mentor Status",
                    "Actions",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left px-5 py-3 text-xs font-semibold text-[#5A7263] uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {alumni.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-[#D6E4DA] hover:bg-[#F7F9F7] transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={a.img}
                          alt={a.name}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                        <div>
                          <p className="font-medium text-[#0F1A14]">{a.name}</p>
                          <p className="text-xs text-[#5A7263]">{a.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[#5A7263]">{a.year}</td>
                    <td className="px-5 py-3 text-[#5A7263]">{a.company}</td>
                    <td className="px-5 py-3">
                      <span className="tag">{a.industry}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`flex items-center gap-1 text-xs font-medium ${
                          a.available ? "text-green-700" : "text-[#5A7263]"
                        }`}
                      >
                        {a.available ? (
                          <>
                            <span className="availability-dot" />
                            Active
                          </>
                        ) : (
                          "Inactive"
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <Btn variant="outline" size="sm">
                          Edit
                        </Btn>
                        <Btn variant="secondary" size="sm">
                          View
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "announcements" && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6 shadow-sm">
            <h2 className="font-semibold text-[#0F1A14] mb-4">
              Compose Announcement
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#5A7263] uppercase tracking-wider mb-1.5">
                  Title
                </label>
                <input
                  className="w-full border border-[#D6E4DA] rounded-xl px-4 py-2.5 text-sm bg-[#F7F9F7]"
                  placeholder="Announcement title..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#5A7263] uppercase tracking-wider mb-1.5">
                  Audience
                </label>
                <select className="w-full border border-[#D6E4DA] rounded-xl px-4 py-2.5 text-sm bg-[#F7F9F7] cursor-pointer">
                  <option>All Alumni</option>
                  <option>All Students</option>
                  <option>Active Mentors</option>
                  <option>Specific Graduating Year</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#5A7263] uppercase tracking-wider mb-1.5">
                  Message
                </label>
                <textarea
                  rows={5}
                  className="w-full border border-[#D6E4DA] rounded-xl px-4 py-2.5 text-sm bg-[#F7F9F7] resize-none"
                  placeholder="Write your announcement here..."
                />
              </div>
              <div className="flex gap-2">
                <Btn variant="primary" className="flex-1">
                  Send Announcement
                </Btn>
                <Btn variant="outline">Save Draft</Btn>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-[#D6E4DA] p-6 shadow-sm">
            <h2 className="font-semibold text-[#0F1A14] mb-4">
              Recent Announcements
            </h2>
            <div className="space-y-4">
              {[
                {
                  title: "Annual Gala: RSVP Now",
                  audience: "All Alumni",
                  date: "Aug 8, 2026",
                  reach: "3,247",
                },
                {
                  title: "Career Fair 2026 – Register Today",
                  audience: "Students",
                  date: "Aug 5, 2026",
                  reach: "1,420",
                },
                {
                  title: "New Mentorship Guidelines",
                  audience: "Active Mentors",
                  date: "Jul 28, 2026",
                  reach: "427",
                },
              ].map(({ title, audience, date, reach }) => (
                <div
                  key={title}
                  className="p-4 border border-[#D6E4DA] rounded-xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#0F1A14] text-sm">
                        {title}
                      </p>
                      <p className="text-xs text-[#5A7263] mt-1">
                        {audience} · Sent {date}
                      </p>
                      <p className="text-xs text-[#0B6B3A] font-medium mt-1">
                        {reach} recipients
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Btn variant="outline" size="sm">
                        Edit
                      </Btn>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── App shell ────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>("landing")

  const pages: Record<Page, React.ReactNode> = {
    landing: <LandingPage setPage={setPage} />,
    "alumni-profile": <AlumniProfilePage setPage={setPage} />,
    "student-dashboard": <StudentDashboard setPage={setPage} />,
    "alumni-dashboard": <AlumniDashboard setPage={setPage} />,
    events: <EventsPage />,
    messaging: <MessagingPage />,
    communities: <CommunitiesPage />,
    admin: <AdminPanel />,
  }

  return (
    <div className="min-h-screen bg-[#F7F9F7]">
      <Navbar page={page} setPage={setPage} />

      {/* Admin link */}
      {page !== "admin" && (
        <div className="bg-[#FDF7E5] border-b border-[#D4A017]/30 px-4 sm:px-6 py-1.5 flex items-center justify-between">
          <p className="text-xs text-[#92690A]">
            Demo: Switch views using buttons below
          </p>
          <div className="flex gap-2">
            {(["student-dashboard", "alumni-dashboard", "admin"] as Page[]).map(
              (p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="text-xs text-[#92690A] hover:text-[#0B6B3A] font-medium underline cursor-pointer"
                >
                  {p === "student-dashboard"
                    ? "Student"
                    : p === "alumni-dashboard"
                      ? "Alumni"
                      : "Admin"}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      <main>{pages[page]}</main>

      <MobileNav page={page} setPage={setPage} />
    </div>
  )
}
