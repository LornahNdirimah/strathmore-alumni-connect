/**
 * Institution-authored marketing copy.
 *
 * Static because it is editorial content, not user data — putting it in a table
 * would add a migration and an admin screen to change a sentence. The live
 * numbers shown alongside it are counted from the database (see content.routes).
 */
export const landingCopy = {
  eyebrow: 'Strathmore alumni network',
  headline: 'Mentorship that moves students from potential to purpose.',
  description:
    'Connect with ambitious graduates, professional mentors, and student communities built on excellence, innovation, and service. Grow your path with guidance that feels personal, practical, and career-building.',
  primaryCta: 'Join the network',
  secondaryCta: 'Sign in',
  whyMentorship: {
    title: 'Why mentorship matters',
    body: 'Real growth happens when students are guided by people who have already navigated the path ahead. Strong mentoring builds clarity, confidence, and momentum.',
    points: [
      'Career clarity and internship guidance',
      'Practical insight from alumni experience',
      'Stronger leadership and collaboration skills',
    ],
  },
  collaboration: {
    title: 'Built for collaboration',
    body: 'Strathmore’s student experience is rooted in care, community, and ethical leadership. The platform extends that culture into a connected alumni network.',
    points: [
      'One-to-one mentorship matching',
      'Career conversations and event access',
      'Shared learning across disciplines',
    ],
  },
} as const

export const testimonials = [
  {
    name: 'Kevin Otieno',
    role: 'Software Engineer at Google',
    quote:
      'Mentorship from a Strathmore alumnus helped me land my dream job at Google. The network here is truly world-class.',
  },
  {
    name: 'Mercy Wanjiku',
    role: 'Investment Analyst',
    quote:
      'Through the Alumni Connect platform, I found an internship at African Development Bank that turned into a full-time role.',
  },
  {
    name: 'Peter Kamau',
    role: 'CTO at M-Pesa Africa',
    quote:
      'The mentorship sessions I had as a student shaped how I lead teams today. Now I give back as a mentor myself.',
  },
] as const
