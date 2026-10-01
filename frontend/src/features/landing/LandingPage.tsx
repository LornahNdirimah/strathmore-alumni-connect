import { useQuery } from '@tanstack/react-query'

import { Icon } from '../../components/ui/Icon'
import { contentApi } from '../../lib/api'
import type { AppPage } from '../../types'

type LandingPageProps = {
  onNavigate: (page: AppPage) => void
}

const steps = [
  {
    title: 'Create your profile',
    description: 'Tell us your goals as a student, or your experience as an alumnus ready to give back.',
  },
  {
    title: 'Get matched',
    description:
      'Our matching surfaces mentors by industry, skills, and availability — no cold outreach required.',
  },
  {
    title: 'Grow together',
    description:
      'Book sessions, message directly, and join collaboration groups that outlast a single conversation.',
  },
]

export function LandingPage({ onNavigate }: LandingPageProps) {
  // Public endpoint — the landing page renders for signed-out visitors, and its
  // statistics are counted live rather than hardcoded.
  const { data } = useQuery({
    queryKey: ['content', 'landing'],
    queryFn: () => contentApi.landing(),
  })

  return (
    <section className="content-panel landing-page">
      <div className="hero-card hero-spotlight">
        <div className="hero-copy">
          <span className="eyebrow">{data?.eyebrow ?? 'Strathmore alumni network'}</span>
          <h1>{data?.headline ?? 'Mentorship that moves students from potential to purpose.'}</h1>
          <p>{data?.description ?? ''}</p>

          <div className="landing-actions">
            <button className="primary-btn large" type="button" onClick={() => onNavigate('signup')}>
              {data?.primaryCta ?? 'Join the network'} <Icon.ArrowRight />
            </button>
            <button className="secondary-btn" type="button" onClick={() => onNavigate('login')}>
              {data?.secondaryCta ?? 'Sign in'}
            </button>
          </div>
        </div>

        <div className="hero-visual" aria-label="Students collaborating and mentoring">
          <img
            src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80"
            alt="Students collaborating and learning together"
          />
        </div>
      </div>

      <div className="stats-grid">
        {(data?.stats ?? []).map((stat) => (
          <div className="stat-card" key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>

      <div>
        <h2 style={{ marginBottom: '1rem' }}>How it works</h2>
        <div className="how-it-works">
          {steps.map((step, index) => (
            <div className="step-card" key={step.title}>
              <span className="step-number">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          ))}
        </div>
      </div>

      {data && (
        <div className="benefits-grid">
          <div className="benefit-card">
            <div className="benefit-card-icon students">
              <Icon.BookOpen />
            </div>
            <h3>{data.whyMentorship.title}</h3>
            <p>{data.whyMentorship.body}</p>
            <ul className="benefit-list">
              {data.whyMentorship.points.map((point) => (
                <li key={point}>
                  <Icon.Check />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="benefit-card">
            <div className="benefit-card-icon alumni">
              <Icon.Users />
            </div>
            <h3>{data.collaboration.title}</h3>
            <p>{data.collaboration.body}</p>
            <ul className="benefit-list">
              {data.collaboration.points.map((point) => (
                <li key={point}>
                  <Icon.Check />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Alumni success stories</h2>
        <div className="content-grid">
          {(data?.testimonials ?? []).map((testimonial) => (
            <div className="panel" key={testimonial.name}>
              <p className="muted-line">"{testimonial.quote}"</p>
              <strong>{testimonial.name}</strong>
              <p className="muted-line">{testimonial.role}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Career focus areas</h2>
        <ul className="tags">
          {(data?.careerTracks ?? []).map((track) => (
            <li key={track}>{track}</li>
          ))}
        </ul>
      </div>

      <div className="cta-band">
        <h2>Ready to build your future?</h2>
        <p>Join a network built on excellence, service, and mentorship that lasts well beyond graduation.</p>
        <div className="cta-band-actions">
          <button
            className="primary-btn large"
            type="button"
            style={{ background: 'var(--gold)' }}
            onClick={() => onNavigate('signup')}
          >
            Get started as a student
          </button>
          <button className="cta-outline-btn" type="button" onClick={() => onNavigate('signup')}>
            Join as alumni
          </button>
        </div>
      </div>
    </section>
  )
}
