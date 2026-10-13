import type { Role } from './types';

export type Action =
  | 'edit_rules' | 'file_review' | 'send_proof' | 'scan_print' | 'pass_qc'
  | 'dispatch' | 'see_contact' | 'reply' | 'claims' | 'reports' | 'assign_press' | 'run_checks'
  | 'manage_team' | 'see_setup' | 'manage_catalog' | 'manage_coupons' | 'quote_custom'
  | 'manage_templates' | 'manage_campaigns' | 'moderate_photos' | 'manage_growth'
  | 'manage_studio' | 'review_studio';

const MATRIX: Record<Action, Role[]> = {
  edit_rules: ['admin', 'production_lead'],
  file_review: ['admin', 'production_lead', 'file_desk'],
  send_proof: ['admin', 'production_lead', 'file_desk'],
  scan_print: ['admin', 'production_lead', 'partner_press'],
  pass_qc: ['admin', 'production_lead'],
  dispatch: ['admin', 'production_lead', 'dispatcher'],
  see_contact: ['admin', 'production_lead', 'file_desk', 'support'],
  reply: ['admin', 'production_lead', 'support'],
  claims: ['admin', 'production_lead'],
  reports: ['admin', 'production_lead', 'support'],
  assign_press: ['admin', 'production_lead'],
  run_checks: ['admin', 'production_lead'],
  manage_team: ['admin'],
  see_setup: ['admin'],
  manage_catalog: ['admin', 'production_lead'],
  manage_coupons: ['admin', 'production_lead'],
  quote_custom: ['admin', 'production_lead', 'support'],
  manage_templates: ['admin', 'production_lead'],
  manage_campaigns: ['admin', 'production_lead'],
  moderate_photos: ['admin', 'production_lead', 'support'],
  manage_growth: ['admin', 'production_lead'],
  manage_studio: ['admin', 'production_lead'],               // settings, prices, margin report, invites
  review_studio: ['admin', 'production_lead', 'file_desk'],  // human checks, flagged requests, sample reviews
};

export const can = (role: Role, action: Action) => MATRIX[action].includes(role);
