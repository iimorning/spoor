/**
 * Interactive landing demo: one ordinary sticky note, two voice cards,
 * and a blank “add a persona” card so visitors see roles are not a fixed set.
 *
 * Persona buttons are polaroid character cards (cover + name), matching
 * canvas agent chrome and community gallery cards — not toolbar tabs.
 */

import React, { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { CautiousCover, LeapCover } from './LandingRoleCovers';

const ROLES = ['cautious', 'leap'] as const;
type RoleId = (typeof ROLES)[number];

const COVER: Record<RoleId, React.FC<{ className?: string }>> = {
  cautious: CautiousCover,
  leap: LeapCover,
};

const TILT: Record<RoleId, string> = {
  cautious: 'lp-roles-card--tilt-l',
  leap: 'lp-roles-card--tilt-r',
};

export function LandingRolesDemo() {
  const { t } = useTranslation();
  const [active, setActive] = useState<RoleId>('cautious');
  const panelId = useId();
  const tabIdPrefix = useId();

  const selectRole = useCallback((id: RoleId) => {
    setActive(id);
  }, []);

  const onCastKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const index = ROLES.indexOf(active);
      if (index < 0) return;
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        next = (index + 1) % ROLES.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = (index - 1 + ROLES.length) % ROLES.length;
      } else if (event.key === 'Home') {
        next = 0;
      } else if (event.key === 'End') {
        next = ROLES.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      const nextId = ROLES[next];
      if (!nextId) return;
      setActive(nextId);
      const btn = event.currentTarget.querySelector<HTMLButtonElement>(
        `[data-role-id="${nextId}"]`,
      );
      btn?.focus();
    },
    [active],
  );

  const activeName = t(`landing.roles_${active}_name`);

  return (
    <div className="lp-roles-stage">
      <figure data-testid="lp-roles-source" className="lp-roles-source">
        <div className="lp-roles-source__chrome lp-roles-note">
          <header className="lp-roles-note__head">
            <span className="lp-roles-note__kicker">
              {t('landing.roles_source_kicker')}
            </span>
          </header>
          <blockquote className="lp-roles-source__quote">
            <p>{t('landing.roles_source_body')}</p>
          </blockquote>
        </div>
        <figcaption className="lp-roles-source__chip">
          {t('landing.roles_source_chip')}
        </figcaption>
      </figure>

      <div className="lp-roles-right">
        <div className="lp-roles-cast">
          <div
            className="lp-roles-cast__tabs"
            role="tablist"
            aria-label={t('landing.roles_cast_label')}
            onKeyDown={onCastKeyDown}
          >
            {ROLES.map((id) => {
              const selected = id === active;
              const name = t(`landing.roles_${id}_name`);
              const role = t(`landing.roles_${id}_role`);
              const Cover = COVER[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`${tabIdPrefix}-${id}`}
                  data-role-id={id}
                  data-testid={`lp-roles-persona-${id}`}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  className={`lp-roles-card ${TILT[id]}${selected ? ' is-on' : ''}`}
                  onClick={() => selectRole(id)}
                >
                  <span className="lp-roles-card__chrome">
                    <span className="lp-roles-card__art">
                      <Cover className="lp-roles-card__img" />
                    </span>
                    <span className="lp-roles-card__label">
                      <span className="lp-roles-card__name">{name}</span>
                      <span className="lp-roles-card__role">{role}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div
            data-testid="lp-roles-add-persona"
            className="lp-roles-card lp-roles-card--add"
            aria-hidden="true"
          >
            <span className="lp-roles-card__chrome">
              <span className="lp-roles-card__art lp-roles-card__art--empty">
                <Plus className="lp-roles-card__plus" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="lp-roles-card__label">
                <span className="lp-roles-card__name">{t('landing.roles_add_name')}</span>
                <span className="lp-roles-card__role">{t('landing.roles_add_role')}</span>
              </span>
            </span>
          </div>
        </div>

        <blockquote
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${tabIdPrefix}-${active}`}
          aria-live="polite"
          data-testid="lp-roles-insight"
          className="lp-roles-insight"
        >
          <div className="lp-roles-insight__chrome">
            <p className="lp-roles-insight__by">
              {t('landing.roles_insight_by', { name: activeName })}
            </p>
            <p key={active} className="lp-roles-insight__text">
              {t(`landing.roles_insight_${active}`)}
            </p>
          </div>
        </blockquote>
      </div>
    </div>
  );
}
