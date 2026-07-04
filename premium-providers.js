'use strict';

/**
 * FREQ Premium Providers
 * Extensible payment provider registry.
 */

class ProviderNotImplemented extends Error {
  constructor(provider) {
    super(`${provider} provider is not implemented.`);
    this.name = 'ProviderNotImplemented';
  }
}

function notImplemented(provider) {
  return async () => {
    throw new ProviderNotImplemented(provider);
  };
}

/* ==========================================================
   Gumroad
========================================================== */

const gumroad = {
  name: 'gumroad',

  async verifyPurchase(data) {
    // TODO:
    // Verify against Gumroad API.
    return {
      valid: false,
      active: false,
      provider: 'gumroad',
      data
    };
  },

  async activateSubscription(data) {
    return {
      success: true,
      provider: 'gumroad',
      data
    };
  },

  async cancelSubscription(data) {
    return {
      success: true,
      provider: 'gumroad',
      data
    };
  },

  async syncSubscription(data) {
    return {
      success: true,
      provider: 'gumroad',
      data
    };
  }
};

/* ==========================================================
   Stripe
========================================================== */

const stripe = {
  name: 'stripe',
  verifyPurchase: notImplemented('Stripe'),
  activateSubscription: notImplemented('Stripe'),
  cancelSubscription: notImplemented('Stripe'),
  syncSubscription: notImplemented('Stripe')
};

/* ==========================================================
   Lemon Squeezy
========================================================== */

const lemonSqueezy = {
  name: 'lemonsqueezy',
  verifyPurchase: notImplemented('Lemon Squeezy'),
  activateSubscription: notImplemented('Lemon Squeezy'),
  cancelSubscription: notImplemented('Lemon Squeezy'),
  syncSubscription: notImplemented('Lemon Squeezy')
};

/* ==========================================================
   Paddle
========================================================== */

const paddle = {
  name: 'paddle',
  verifyPurchase: notImplemented('Paddle'),
  activateSubscription: notImplemented('Paddle'),
  cancelSubscription: notImplemented('Paddle'),
  syncSubscription: notImplemented('Paddle')
};

/* ==========================================================
   Polar
========================================================== */

const polar = {
  name: 'polar',
  verifyPurchase: notImplemented('Polar'),
  activateSubscription: notImplemented('Polar'),
  cancelSubscription: notImplemented('Polar'),
  syncSubscription: notImplemented('Polar')
};

/* ==========================================================
   Registry
========================================================== */

const providers = {
  gumroad,
  stripe,
  lemonsqueezy: lemonSqueezy,
  paddle,
  polar
};

function getPremiumProvider(name) {
  if (!name) return null;

  return providers[String(name).toLowerCase()] || null;
}

function listPremiumProviders() {
  return Object.keys(providers);
}

module.exports = {
  providers,
  getPremiumProvider,
  listPremiumProviders
};
