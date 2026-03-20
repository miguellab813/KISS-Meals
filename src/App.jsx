import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE CLIENT ─────────────────────────────────────────────────────────
// Keys are injected at build time via Vercel env vars (never in source control)
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL  || "https://funwzigyhjbgasivmogb.supabase.co";
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1bnd6aWd5aGpiZ2FzaXZtb2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMTM0NjksImV4cCI6MjA4OTU4OTQ2OX0.PJ5ynXt8Ni-aj0vJe4BrMcxfYcugEFcvwkABuzYJZKI";

let _supa = null;
async function getSupa() {
  if (_supa) return _supa;
  // Load Supabase from CDN — no npm install needed
  if (!window.__supabaseLoaded) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    window.__supabaseLoaded = true;
  }
  _supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  return _supa;
}

// ─── DB HELPERS ──────────────────────────────────────────────────────────────

async function dbLoadProfiles(accountId) {
  const sb = await getSupa();
  const { data, error } = await sb.from('profiles').select('*').eq('account_id', accountId).order('created_at');
  if (error) { console.error('loadProfiles:', error); return []; }
  return (data || []).map(row => ({
    id:           row.id,
    name:         row.name,
    age:          row.age,
    gender:       row.gender,
    macroMode:    row.macro_mode,
    protein:      row.protein,
    carbs:        row.carbs,
    fat:          row.fat,
    cals:         row.cals,
    goal:         row.goal,
    goal_raw:     row.goal_raw,
    activity:     row.activity,
    weight:       row.weight,
    proteinG:     row.protein_g,
    carbPct:      row.carb_pct,
    tdee:         row.tdee,
    days:         row.days || '5',
    mealsPerDay:  row.meals_per_day || '1',
    restrictions: row.restrictions || ['None'],
    otherMeals:   row.other_meals || null,
    meal:         { protein: null, carb: null, veggie: null },
    _dbId:        row.id,
  }));
}

async function dbSaveProfile(accountId, user) {
  const sb = await getSupa();
  const row = {
    account_id:    accountId,
    name:          user.name,
    age:           user.age,
    gender:        user.gender,
    macro_mode:    user.macroMode,
    protein:       user.protein,
    carbs:         user.carbs,
    fat:           user.fat,
    cals:          user.cals,
    goal:          user.goal,
    goal_raw:      user.goal_raw,
    activity:      user.activity,
    weight:        user.weight,
    protein_g:     user.proteinG,
    carb_pct:      user.carbPct,
    tdee:          user.tdee,
    days:          user.days || '5',
    meals_per_day: user.mealsPerDay || '1',
    restrictions:  user.restrictions || ['None'],
    other_meals:   user.otherMeals || null,
    updated_at:    new Date().toISOString(),
  };
  if (user._dbId) {
    const { error } = await sb.from('profiles').update(row).eq('id', user._dbId);
    if (error) console.error('updateProfile:', error);
    return user._dbId;
  } else {
    const { data, error } = await sb.from('profiles').insert(row).select('id').single();
    if (error) { console.error('insertProfile:', error); return null; }
    return data?.id;
  }
}

async function dbDeleteProfile(dbId) {
  const sb = await getSupa();
  const { error } = await sb.from('profiles').delete().eq('id', dbId);
  if (error) console.error('deleteProfile:', error);
}

async function dbLoadCycles(accountId) {
  const sb = await getSupa();
  const { data, error } = await sb.from('cycles').select('*').eq('account_id', accountId).order('created_at', { ascending: false }).limit(10);
  if (error) { console.error('loadCycles:', error); return []; }
  return (data || []).map(row => ({
    id:           row.id,
    date:         new Date(row.created_at).toLocaleDateString(),
    days:         row.round_days,
    mealsPerDay:  row.round_meals_per_day,
    equipment:    row.equipment || [],
    methodChoices:row.method_choices || {},
    users:        row.users_snapshot || [],
  }));
}

async function dbSaveCycle(accountId, data) {
  const sb = await getSupa();
  const row = {
    account_id:          accountId,
    round_days:          data.round?.days || 5,
    round_meals_per_day: data.round?.mealsPerDay || 1,
    equipment:           data.equipment || [],
    method_choices:      data.methodChoices || {},
    users_snapshot:      data.users || [],
  };
  const { error } = await sb.from('cycles').insert(row);
  if (error) console.error('saveCycle:', error);
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// rawPerServing = raw grams for ONE standard serving
// cookedPerServing = cooked grams for ONE standard serving
// Macros are per ONE standard serving
// Standard serving = ~6oz raw / ~4.5oz cooked for proteins (typical single meal prep portion)
// Users who need more protein will need multiple servings — app will calculate and scale

const PROTEINS = [
  // Chicken Breast: 6oz raw (170g) → ~4.6oz cooked (130g) → 39g protein per serving
  { id: "chicken_breast", name: "Chicken Breast",    rawPerServing: 170, cookedPerServing: 130, cals: 195, protein: 39, carbs: 0, fat:  4, shelfDays: 4,
    proteinPer100gCooked: 30 },
  // Ground Turkey: 6oz raw (170g) → ~5oz cooked (140g) → 30g protein per serving
  { id: "ground_turkey",  name: "Ground Turkey",     rawPerServing: 170, cookedPerServing: 140, cals: 218, protein: 30, carbs: 0, fat: 11, shelfDays: 4,
    proteinPer100gCooked: 21 },
  // Ground Beef 85/15: 6oz raw (170g) → ~4.6oz cooked (130g) → 28g protein per serving
  { id: "ground_beef_85", name: "Ground Beef 85/15", rawPerServing: 170, cookedPerServing: 130, cals: 340, protein: 28, carbs: 0, fat: 24, shelfDays: 4,
    proteinPer100gCooked: 22 },
  // Ground Beef 93/7: 6oz raw (170g) → ~4.8oz cooked (135g) → 32g protein per serving
  { id: "ground_beef_93", name: "Ground Beef 93/7",  rawPerServing: 170, cookedPerServing: 135, cals: 258, protein: 32, carbs: 0, fat: 14, shelfDays: 4,
    proteinPer100gCooked: 24 },
];
const CARBS = [
  { id: "white_rice", name: "White Rice", rawPerServing:  80, cookedPerServing: 240, cals: 286, protein: 5, carbs: 63, fat: 1, shelfDays: 5 },
  { id: "potatoes",   name: "Potatoes",   rawPerServing: 200, cookedPerServing: 185, cals: 154, protein: 4, carbs: 35, fat: 0, shelfDays: 5 },
];
const VEGGIES = [
  { id: "carrots",  name: "Carrots",  rawPerServing: 100, cookedPerServing: 85, cals: 41, protein: 1, carbs: 10, fat: 0, shelfDays: 7 },
  { id: "broccoli", name: "Broccoli", rawPerServing: 100, cookedPerServing: 85, cals: 34, protein: 3, carbs:  7, fat: 0, shelfDays: 5 },
];

const COOKING_METHODS = ["Air Fryer","Oven","Stovetop","Blackstone","Grill","Crockpot","Rice Cooker"];

const COOKING_INSTRUCTIONS = {
  chicken_breast: {
    "Air Fryer":   { temp:"375°F",    time:"18–22 min",   tips:"Flip halfway. Rest 5 min before slicing. Internal temp 165°F. Lightly oil for best results." },
    "Oven":        { temp:"425°F",    time:"22–26 min",   tips:"Cover with foil first 15 min, uncover to finish. Rest before slicing." },
    "Stovetop":    { temp:"Med-High", time:"6–8 min/side",tips:"Pound to even thickness. Oil the pan. Cover to retain moisture." },
    "Blackstone":  { temp:"Med-High", time:"5–7 min/side",tips:"Great flat-surface sear. Oil griddle well. Smash slightly for even contact. Rest before slicing." },
    "Grill":       { temp:"400–450°F",time:"6–8 min/side",tips:"Grill marks add great flavor. Close lid between flips. Rest 5 min. Internal temp 165°F." },
    "Crockpot":    { temp:"Low",      time:"4–5 hrs",     tips:"Add ½ cup broth. Great for bulk — shreds easily for containers. Set and forget." },
    "Rice Cooker": { temp:"N/A",      time:"N/A",         tips:"Not recommended for chicken. Use another method." },
  },
  ground_turkey: {
    "Air Fryer":   { temp:"375°F",  time:"12–15 min",tips:"Break into crumbles before. Shake basket halfway through." },
    "Oven":        { temp:"400°F",  time:"20–25 min",tips:"Spread on sheet pan. Break up halfway. Drain excess liquid." },
    "Stovetop":    { temp:"Medium", time:"10–12 min",tips:"Best method. Stir constantly. Drain fat before portioning." },
    "Blackstone":  { temp:"Medium", time:"10–12 min",tips:"Large flat surface is perfect for crumbling ground meat. Easy draining." },
    "Grill":       { temp:"Medium", time:"10–12 min",tips:"Use a grill basket or cast iron pan on the grill. Stir frequently." },
    "Crockpot":    { temp:"High",   time:"2–3 hrs",  tips:"Brown on stovetop first for best texture, then transfer." },
    "Rice Cooker": { temp:"N/A",    time:"N/A",      tips:"Not suitable for ground turkey." },
  },
  ground_beef_85: {
    "Air Fryer":   { temp:"370°F",    time:"10–14 min",tips:"Crumble form. Line basket. Drain fat after cooking." },
    "Oven":        { temp:"400°F",    time:"20–25 min",tips:"Sheet pan. Drain fat well. Season after for better macro control." },
    "Stovetop":    { temp:"Med-High", time:"8–10 min", tips:"Best fat management. Drain thoroughly before portioning." },
    "Blackstone":  { temp:"Med-High", time:"8–10 min", tips:"Excellent method — fat runs off easily on flat top. Easy cleanup." },
    "Grill":       { temp:"Med-High", time:"8–10 min", tips:"Use cast iron on the grill. Drain fat well before portioning." },
    "Crockpot":    { temp:"High",     time:"2–3 hrs",  tips:"Brown first for better texture. Drain fat well after." },
    "Rice Cooker": { temp:"N/A",      time:"N/A",      tips:"Not suitable for ground beef." },
  },
  ground_beef_93: {
    "Air Fryer":   { temp:"370°F",  time:"10–12 min",tips:"Leaner — cooks faster. Watch closely to avoid drying out." },
    "Oven":        { temp:"400°F",  time:"18–22 min",tips:"Less fat to drain. Great for bulk. Even layer for consistent cook." },
    "Stovetop":    { temp:"Medium", time:"8–10 min", tips:"Preferred method. Minimal drainage. Versatile and quick." },
    "Blackstone":  { temp:"Medium", time:"8–10 min", tips:"Clean cook. Very little fat runoff. Fast and efficient on flat top." },
    "Grill":       { temp:"Medium", time:"8–10 min", tips:"Cast iron skillet on grill works great. Minimal drainage needed." },
    "Crockpot":    { temp:"High",   time:"2–3 hrs",  tips:"Brown first. Less greasy than 85/15. Easy batch option." },
    "Rice Cooker": { temp:"N/A",    time:"N/A",      tips:"Not suitable for ground beef." },
  },
  white_rice: {
    "Air Fryer":   { temp:"N/A",      time:"N/A",             tips:"Not recommended. Use stovetop or rice cooker." },
    "Oven":        { temp:"375°F",    time:"30–35 min",        tips:"Covered oven-safe dish: 1 cup rice to 1.75 cups water." },
    "Stovetop":    { temp:"High→Low", time:"18–20 min",        tips:"Boil water, add rice, cover, reduce heat. Do not lift lid. Rest 5 min." },
    "Blackstone":  { temp:"N/A",      time:"N/A",             tips:"Not suitable for rice on a flat top. Use stovetop or rice cooker." },
    "Grill":       { temp:"N/A",      time:"N/A",             tips:"Not suitable for rice on a grill." },
    "Crockpot":    { temp:"High",     time:"2–2.5 hrs",        tips:"1:1.5 rice to water. Check at 2 hrs." },
    "Rice Cooker": { temp:"Auto",     time:"25–35 min",        tips:"Best method for bulk rice. 1:1 ratio. Perfect every time. Keep-warm function is ideal on prep day." },
  },
  potatoes: {
    "Air Fryer":   { temp:"400°F",    time:"20–25 min",tips:"Uniform cubes. Toss in oil. Shake halfway. Crispy results." },
    "Oven":        { temp:"425°F",    time:"30–35 min",tips:"Cube evenly. Light oil. Flip once. Don't crowd the pan." },
    "Stovetop":    { temp:"Medium",   time:"15–20 min",tips:"Boil until fork-tender ~15 min. Drain well before portioning." },
    "Blackstone":  { temp:"Medium",   time:"18–22 min",tips:"Cube small. Oil flat top well. Dome lid to steam-cook. Excellent crust." },
    "Grill":       { temp:"400°F",    time:"20–25 min",tips:"Foil packet with oil. Cube evenly. Seal tight and flip once." },
    "Crockpot":    { temp:"High",     time:"3–4 hrs",  tips:"Add ½ cup water. Cube evenly for consistent cooking." },
    "Rice Cooker": { temp:"N/A",      time:"N/A",      tips:"Not recommended for potatoes." },
  },
  carrots: {
    "Air Fryer":   { temp:"380°F", time:"12–15 min",tips:"Slice uniform. Light oil. Toss halfway. Slightly caramelized." },
    "Oven":        { temp:"400°F", time:"20–25 min",tips:"Sheet pan. Slice ½ inch thick. Flip once for even browning." },
    "Stovetop":    { temp:"Medium",time:"10–12 min",tips:"Steam or sauté. Splash of water + cover to steam-cook." },
    "Blackstone":  { temp:"Medium",time:"10–12 min",tips:"Slice thin. Oil flat top. Great caramelization on flat surface." },
    "Grill":       { temp:"Medium",time:"12–15 min",tips:"Foil packet or grill basket. Light oil. Flip once." },
    "Crockpot":    { temp:"Low",   time:"4–5 hrs",  tips:"Will become very soft. Good for those who prefer tender textures." },
    "Rice Cooker": { temp:"N/A",   time:"N/A",      tips:"Not suitable for carrots." },
  },
  broccoli: {
    "Air Fryer":   { temp:"375°F",    time:"8–10 min", tips:"Best method. Crispy edges. Toss in oil first." },
    "Oven":        { temp:"425°F",    time:"15–18 min",tips:"High heat for caramelized edges. Don't crowd the pan." },
    "Stovetop":    { temp:"Medium",   time:"6–8 min",  tips:"Steam with ¼ cup water covered, or sauté in oil. Don't overcook." },
    "Blackstone":  { temp:"Med-High", time:"6–8 min",  tips:"Oil flat top. High heat gives great char. Move constantly." },
    "Grill":       { temp:"Med-High", time:"6–8 min",  tips:"Grill basket or foil. High heat for char. Don't overcook." },
    "Crockpot":    { temp:"Low",      time:"2–3 hrs",  tips:"Add near end to avoid mush. Air fryer or oven preferred." },
    "Rice Cooker": { temp:"N/A",      time:"N/A",      tips:"Not suitable for broccoli." },
  },
};

const SUGGESTED_METHOD = {
  chicken_breast: "Grill", ground_turkey: "Stovetop",
  ground_beef_85: "Blackstone", ground_beef_93: "Blackstone",
  white_rice: "Rice Cooker", potatoes: "Air Fryer",
  carrots: "Air Fryer", broccoli: "Air Fryer",
};

const STORAGE_TIPS = [
  "Let all food cool completely (≤2 hrs) before sealing containers.",
  "Use airtight containers — glass preferred for reheating.",
  "Stack containers with heaviest on bottom in the fridge.",
  "Keep containers in the coldest part of the fridge (back, lower shelves).",
  "Never store containers that still have steam — condensation breeds bacteria.",
];
const REHEAT_TIPS = {
  Microwave:   "Add a damp paper towel over the container. Heat 90 sec, stir/flip, heat another 60 sec. Prevents drying out.",
  "Air Fryer": "375°F for 4–6 min. Best for crisping up potatoes and chicken. Keep protein separate from carbs if possible.",
  Oven:        "Cover with foil at 350°F for 15–20 min. Best for large portions or multiple containers at once.",
  "Eat Cold":  "Rice and potatoes are great cold. Chicken and turkey can be eaten cold sliced over the carb. Fast and refreshing.",
};
const RESTRICTIONS = ["None","Gluten-Free","Dairy-Free","Halal","Kosher","Vegetarian","Vegan","Nut Allergy","Other"];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const gToOz  = g => g / 28.3495;
const gToLbs = g => g / 453.592;

function formatImperialWeight(grams) {
  const oz = gToOz(grams);
  const lbs = Math.floor(gToLbs(grams));
  const remOz = Math.round(oz % 16);
  if (oz >= 16) return lbs > 0 ? (remOz > 0 ? `${lbs} lb ${remOz} oz` : `${lbs} lbs`) : `${oz.toFixed(1)} oz`;
  return `${oz.toFixed(1)} oz`;
}

function packageGuide(grams) {
  const oz = gToOz(grams);
  return [12,16,24,32].map(size => ({ size, count: Math.ceil(oz / size) }));
}

// How many grams cooked protein a user needs to hit their lunch protein target
// otherMeals payload stores remaining macros directly at top level (after deduction)
function calcCookedProteinNeeded(user, proteinId) {
  const p = PROTEINS.find(x => x.id === proteinId);
  if (!p) return 130;
  // If otherMeals was logged, .protein IS the remaining lunch target (pre-calculated)
  // If no otherMeals, use full daily protein target
  const lunchProteinTarget = user?.otherMeals
    ? Math.max(0, +user.otherMeals.protein || 0)
    : (+user.protein || 0);
  if (!lunchProteinTarget) return p.cookedPerServing;
  const cookedNeeded = Math.round((lunchProteinTarget / p.proteinPer100gCooked) * 100);
  return Math.min(300, Math.max(p.cookedPerServing, cookedNeeded));
}

// Raw grams needed given a cooked gram target (accounts for ~25% cook-off loss for proteins)
function cookedToRaw(cookedG, itemId) {
  const isProtein = PROTEINS.some(x => x.id === itemId);
  if (!isProtein) return cookedG; // carbs/veggies: use raw directly
  // Proteins lose ~20-25% weight during cooking
  return Math.round(cookedG / 0.76);
}

function calcMacros(meal, user) {
  const p = PROTEINS.find(x => x.id === meal.protein);
  const c = CARBS.find(x => x.id === meal.carb);
  const v = meal.veggie ? VEGGIES.find(x => x.id === meal.veggie) : null;
  if (!p || !c) return null;

  // Scale protein macros to user's actual cooked portion if user is provided
  let proteinG, proteinCals, proteinFat;
  if (user) {
    const cookedG = calcCookedProteinNeeded(user, meal.protein);
    const scale   = cookedG / p.cookedPerServing;
    proteinG    = Math.round(p.protein * scale);
    proteinCals = Math.round(p.cals * scale);
    proteinFat  = Math.round(p.fat * scale);
  } else {
    proteinG    = p.protein;
    proteinCals = p.cals;
    proteinFat  = p.fat;
  }

  return {
    cals:    Math.round(proteinCals + c.cals + (v ? v.cals    : 0)),
    protein: Math.round(proteinG    + c.protein + (v ? v.protein : 0)),
    carbs:   Math.round(p.carbs     + c.carbs   + (v ? v.carbs   : 0)),
    fat:     Math.round(proteinFat  + c.fat     + (v ? v.fat     : 0)),
  };
}

function calcShelfLife(meal) {
  const p = PROTEINS.find(x => x.id === meal.protein);
  const c = CARBS.find(x => x.id === meal.carb);
  const v = meal.veggie ? VEGGIES.find(x => x.id === meal.veggie) : null;
  return Math.min(...[p?.shelfDays, c?.shelfDays, v?.shelfDays].filter(Boolean));
}
// ── AUTO-OPTIMIZE meal to hit macro targets ──────────────────────────────────
// Priority: 1) protein (exact), 2) calories (scale carb), 3) report carb/fat result
// Returns { proteinCookedG, carbCookedG, veggieCookedG, carbRawG, macros }
function calcOptimalMeal(meal, user, lunchTargets) {
  const p = PROTEINS.find(x => x.id === meal.protein);
  const c = CARBS.find(x => x.id === meal.carb);
  const v = meal.veggie ? VEGGIES.find(x => x.id === meal.veggie) : null;
  if (!p || !c) return null;

  // STEP 1: Lock protein to hit protein target exactly
  const proteinCookedG = calcCookedProteinNeeded(user, meal.protein);
  const proteinRawG    = cookedToRaw(proteinCookedG, meal.protein);
  const proteinScale   = proteinCookedG / p.cookedPerServing;

  const proteinMacros = {
    cals:    Math.round(p.cals    * proteinScale),
    protein: Math.round(p.protein * proteinScale),
    carbs:   Math.round(p.carbs   * proteinScale),
    fat:     Math.round(p.fat     * proteinScale),
  };

  // STEP 2: Veggie is fixed (optional, doesn't change)
  const veggieCookedG  = v ? v.cookedPerServing : 0;
  const veggieMacros   = v ? { cals: v.cals, protein: v.protein, carbs: v.carbs, fat: v.fat } : { cals:0, protein:0, carbs:0, fat:0 };

  // STEP 3: Calories remaining for carb after protein + veggie
  const tgtCals    = Math.round(+lunchTargets.cals    || 0);
  const tgtProtein = Math.round(+lunchTargets.protein || 0);

  const calsUsedSoFar  = proteinMacros.cals + veggieMacros.cals;
  const calsForCarb    = Math.max(0, tgtCals - calsUsedSoFar);

  // Scale carb serving to fill remaining calorie budget
  // Each gram of cooked carb delivers c.cals/c.cookedPerServing kcal
  const calsPerGramCarb = c.cals / c.cookedPerServing;
  let carbCookedG = calsForCarb > 0 && calsPerGramCarb > 0
    ? Math.round(calsForCarb / calsPerGramCarb)
    : c.cookedPerServing;

  // Floor at minimum 1 serving, cap at 3x serving (don't go crazy)
  carbCookedG = Math.max(c.cookedPerServing, Math.min(c.cookedPerServing * 3, carbCookedG));

  // For raw carb weight: rice/oats expand when cooked (raw is lighter), potatoes shrink slightly
  // Use the rawPerServing : cookedPerServing ratio from the data
  const carbScale   = carbCookedG / c.cookedPerServing;
  const carbRawG    = Math.round(c.rawPerServing * carbScale);

  const carbMacros = {
    cals:    Math.round(c.cals    * carbScale),
    protein: Math.round(c.protein * carbScale),
    carbs:   Math.round(c.carbs   * carbScale),
    fat:     Math.round(c.fat     * carbScale),
  };

  const totalMacros = {
    cals:    proteinMacros.cals    + carbMacros.cals    + veggieMacros.cals,
    protein: proteinMacros.protein + carbMacros.protein + veggieMacros.protein,
    carbs:   proteinMacros.carbs   + carbMacros.carbs   + veggieMacros.carbs,
    fat:     proteinMacros.fat     + carbMacros.fat     + veggieMacros.fat,
  };

  return {
    proteinCookedG,
    proteinRawG,
    carbCookedG,
    carbRawG,
    veggieCookedG,
    macros: totalMacros,
    proteinMacros,
    carbMacros,
    veggieMacros,
  };
}



function calcRawWeights(users, _legacyDays) {
  // Uses per-user days if available, falls back to passed-in days
  const totals = {};
  users.forEach(u => {
    if (!u.meal?.protein || !u.meal?.carb) return;
    const userDays = Math.round(+(u.days || _legacyDays || 5));
    const userMpd  = Math.round(+(u.mealsPerDay || 1));
    const p = PROTEINS.find(x => x.id === u.meal.protein);
    const c = CARBS.find(x => x.id === u.meal.carb);
    const v = u.meal.veggie ? VEGGIES.find(x => x.id === u.meal.veggie) : null;
    // Use lunchTargets so carb is scaled to fill remaining calories
    const lunchTargets = u.otherMeals
      ? { cals: +u.otherMeals.cals||0, protein: +u.otherMeals.protein||0, carbs: +u.otherMeals.carbs||0, fat: +u.otherMeals.fat||0 }
      : { cals: +u.cals||0, protein: +u.protein||0, carbs: +u.carbs||0, fat: +u.fat||0 };
    const opt = calcOptimalMeal(u.meal, u, lunchTargets);
    const entries = opt ? [
      [p.name, true,  opt.proteinRawG],
      [c.name, false, opt.carbRawG],
      ...(v ? [[v.name, false, v.rawPerServing]] : []),
    ] : [
      [p.name, true,  cookedToRaw(calcCookedProteinNeeded(u, u.meal.protein), u.meal.protein)],
      [c.name, false, c.rawPerServing],
      ...(v ? [[v.name, false, v.rawPerServing]] : []),
    ];
    entries.forEach(([key, isP, rawAmt]) => {
      if (!totals[key]) totals[key] = { g: 0, isProtein: isP };
      totals[key].g += rawAmt * userDays * userMpd;
    });
  });
  return totals;
}

function estimateTDEE(gender, weightLbs, age, activity) {
  const kg = parseFloat(weightLbs) * 0.453592;
  const ageN = parseFloat(age) || 25;
  const mult = { low: 1.2, medium: 1.55, high: 1.725 }[activity] || 1.375;
  const bmr = gender === "male"
    ? 10*kg + 6.25*170 - 5*ageN + 5
    : 10*kg + 6.25*160 - 5*ageN - 161;
  return Math.round(bmr * mult);
}

function initMeal() { return { protein: null, carb: null, veggie: null, _noVeg: false }; }

// Scroll to top of page on every screen transition (critical for mobile)
function scrollToTop() {
  // Try the .page div first (main scroll container), then window
  const page = document.querySelector('.page');
  if (page) page.scrollIntoView({ block: 'start', behavior: 'instant' });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const S = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

  :root {
    --bg:#000;--surf:#0f0f0f;--surf2:#181818;--surf3:#212121;
    --bdr:#303030;--bdr2:#404040;
    --acc:#ff4d00;--acc2:#ff8c00;
    --grn:#00e676;--red:#ff1744;--ylw:#ffea00;
    --txt:#ffffff;--txt2:#dddddd;--muted:#909090;
    --fd:'Bebas Neue',sans-serif;--fb:'DM Sans',sans-serif;
    --safe-top:env(safe-area-inset-top,0px);
    --safe-bot:env(safe-area-inset-bottom,0px);
    --safe-l:env(safe-area-inset-left,0px);
    --safe-r:env(safe-area-inset-right,0px);
  }

  /* ── RESET & BASE ── */
  html{height:-webkit-fill-available}
  body{
    background:var(--bg);color:var(--txt);font-family:var(--fb);
    -webkit-font-smoothing:antialiased;
    /* Prevent iOS text-size adjust on rotation */
    -webkit-text-size-adjust:100%;
    /* Prevent pull-to-refresh rubberbanding interfering with scroll */
    overscroll-behavior-y:contain;
    min-height:100vh;min-height:-webkit-fill-available;
  }
  /* Prevent double-tap zoom on interactive elements */
  button,a,.pill,.oc,.hi,.nt{touch-action:manipulation}
  /* Prevent iOS callout on long press of non-text */
  .card,.oc,.pill,.btn,.hi{-webkit-user-select:none;user-select:none}

  .app{
    min-height:100vh;max-width:500px;margin:0 auto;
    /* Extra padding at bottom for home indicator bar */
    padding-bottom:calc(90px + var(--safe-bot));
  }

  /* ── HEADER ── */
  .hdr{
    background:#0a1a0e;border-bottom:2px solid #2d6a35;
    padding:14px 20px 12px;
    padding-top:calc(14px + var(--safe-top));
    padding-left:calc(20px + var(--safe-l));
    padding-right:calc(20px + var(--safe-r));
    position:sticky;top:0;z-index:100;
  }
  .hdr-row{display:flex;align-items:center;justify-content:space-between}
  .logo-img{height:52px;width:auto;display:block;object-fit:contain;filter:drop-shadow(0 0 6px rgba(0,0,0,.5))}
  .logo-sub{font-size:10px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;margin-top:3px}
  .hdr-info{text-align:right}
  .hdr-info .days{font-family:var(--fd);font-size:20px;color:var(--acc);line-height:1}
  .hdr-info .sub{font-size:10px;color:var(--muted)}

  /* ── NAV TABS ── */
  .nav{
    display:flex;background:#000;border-bottom:1px solid var(--bdr);
    position:sticky;top:66px;z-index:99;
    padding-left:var(--safe-l);padding-right:var(--safe-r);
  }
  /* Bigger tap target — full height clickable */
  .nt{flex:1;cursor:pointer;border-bottom:3px solid transparent;transition:border-color .15s;position:relative;-webkit-tap-highlight-color:transparent}
  .nt.locked{opacity:.28;cursor:not-allowed;pointer-events:none}
  .nt.active{border-bottom-color:var(--acc)}
  .nt.done{border-bottom-color:var(--grn)}
  .nt.next{border-bottom-color:var(--ylw)}
  /* Generous tap zone */
  .nt-in{padding:12px 4px;text-align:center;min-height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .nt-icon{font-size:18px;display:block}
  .nt-lbl{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:3px;color:var(--muted)}
  .nt.active .nt-lbl{color:var(--acc)}
  .nt.done  .nt-lbl{color:var(--grn)}
  .nt.next  .nt-lbl{color:var(--ylw)}
  .nt-dot{position:absolute;top:7px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--ylw);animation:pulse 1.5s infinite}
  .nt.done .nt-dot{background:var(--grn);animation:none}
  .nt.active .nt-dot{display:none}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(1.35)}}

  /* ── PAGE CONTENT ── */
  .page{
    padding:20px;
    padding-left:calc(20px + var(--safe-l));
    padding-right:calc(20px + var(--safe-r));
  }
  .pt{font-family:var(--fd);font-size:34px;letter-spacing:2px;color:#fff;line-height:1.1;margin-bottom:4px}
  .pt span{color:var(--acc)}
  .ps{font-size:15px;color:var(--txt2);margin-bottom:22px;line-height:1.55}

  /* ── BANNER ── */
  .banner{background:rgba(255,234,0,.07);border:1.5px solid rgba(255,234,0,.35);border-radius:12px;padding:13px 15px;margin-bottom:18px;display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;color:var(--ylw)}

  /* ── CARD ── */
  .card{background:var(--surf2);border:1px solid var(--bdr);border-radius:14px;padding:16px;margin-bottom:14px}
  .ct{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:14px}

  /* ── INPUTS ── */
  .lbl{font-size:13px;font-weight:600;color:var(--txt2);margin-bottom:7px;display:block}
  .inp{
    width:100%;background:var(--surf3);border:1.5px solid var(--bdr2);
    border-radius:10px;padding:15px 14px;color:#fff;
    font-family:var(--fb);
    /* 16px minimum prevents iOS auto-zoom on focus */
    font-size:16px;
    outline:none;transition:border-color .2s;margin-bottom:12px;
    /* iOS styling reset */
    -webkit-appearance:none;appearance:none;
  }
  .inp:focus{border-color:var(--acc);background:var(--surf2)}
  .inp::placeholder{color:var(--muted)}
  .inp[disabled]{background:#111;color:var(--muted);cursor:not-allowed;border-color:var(--bdr)}
  .ig{display:flex;gap:10px}
  .ig>div{flex:1}

  /* ── BUTTONS ── */
  .btn{
    display:flex;align-items:center;justify-content:center;gap:8px;
    /* 52px min height = comfortable thumb tap */
    padding:16px 20px;min-height:52px;
    border-radius:12px;font-family:var(--fb);font-size:15px;font-weight:700;
    cursor:pointer;border:none;
    /* Instant feedback — no hover delay on mobile */
    transition:opacity .1s,transform .1s;
    width:100%;margin-top:10px;
    /* Remove iOS button styling */
    -webkit-appearance:none;appearance:none;
    -webkit-tap-highlight-color:transparent;
  }
  .btn:active:not(:disabled){opacity:.75;transform:scale(.98)}
  .btn:disabled{opacity:.28;cursor:not-allowed;transform:none!important}
  .bp{background:var(--acc);color:#fff}
  .bs{background:var(--surf3);color:#fff;border:1.5px solid var(--bdr2)}
  .bg{background:transparent;color:var(--muted);border:1.5px solid var(--bdr)}
  /* Small button variant */
  .bsm{padding:11px 16px;font-size:13px;width:auto;margin-top:0;min-height:44px}

  /* ── PILLS ── */
  .pg{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
  .pill{
    padding:10px 16px;border-radius:100px;font-size:13px;font-weight:600;
    border:1.5px solid var(--bdr2);background:var(--surf3);color:var(--txt2);
    cursor:pointer;
    /* 44px min height for thumb */
    min-height:44px;display:inline-flex;align-items:center;
    -webkit-tap-highlight-color:transparent;
    transition:border-color .1s,background .1s;
  }
  .pill:active{opacity:.7}
  .pill.on{border-color:var(--acc);background:rgba(255,77,0,.15);color:#fff}

  /* ── OPTION CARDS ── */
  .oc{
    background:var(--surf3);border:1.5px solid var(--bdr2);
    border-radius:12px;padding:16px;margin-bottom:10px;
    cursor:pointer;display:flex;align-items:flex-start;gap:14px;
    -webkit-tap-highlight-color:transparent;
    transition:border-color .1s,background .1s;
    /* Generous touch target */
    min-height:60px;
  }
  .oc:active{background:rgba(255,255,255,.04)}
  .oc.sel{border-color:var(--acc);background:rgba(255,77,0,.09)}
  .or{width:22px;height:22px;border-radius:50%;border:2px solid var(--bdr2);flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;transition:all .15s}
  .oc.sel .or{border-color:var(--acc);background:var(--acc)}
  .oc.sel .or::after{content:'';width:8px;height:8px;border-radius:50%;background:#fff}
  .ob{flex:1}
  .on2{font-size:16px;font-weight:700;color:#fff}
  .om{font-size:13px;color:var(--muted);margin-top:4px;line-height:1.5}

  /* ── MACROS ── */
  .mr{display:flex;gap:8px;margin-bottom:12px}
  .mc{flex:1;background:var(--surf3);border:1px solid var(--bdr2);border-radius:10px;padding:12px 6px;text-align:center}
  .mc .v{font-family:var(--fd);font-size:22px;color:#fff;line-height:1}
  .mc .l{font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-top:3px}
  .mc.hl{border-color:var(--acc)}
  .mc.hl .v{color:var(--acc)}

  /* ── ALERTS ── */
  .al{border-radius:12px;padding:14px 15px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.55}
  .ar{background:rgba(255,23,68,.1);border:1px solid rgba(255,23,68,.4);color:#ff8099}
  .ag{background:rgba(0,230,118,.08);border:1px solid rgba(0,230,118,.3);color:var(--grn)}
  .ao{background:rgba(255,140,0,.1);border:1px solid rgba(255,140,0,.35);color:var(--acc2)}
  .ay{background:rgba(255,234,0,.07);border:1px solid rgba(255,234,0,.3);color:var(--ylw)}
  .ai{font-size:20px;flex-shrink:0;margin-top:1px}

  /* ── USER ROW ── */
  .ur{display:flex;align-items:center;gap:12px;padding:14px;background:var(--surf3);border-radius:12px;margin-bottom:8px;border:1px solid var(--bdr2)}
  .uav{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--acc),var(--acc2));display:flex;align-items:center;justify-content:center;font-family:var(--fd);font-size:20px;color:#fff;flex-shrink:0}
  .ui{flex:1;min-width:0}
  .un{font-size:15px;font-weight:700;color:#fff}
  .usb{font-size:12px;color:var(--muted);margin-top:2px}

  /* ── STEP DOTS ── */
  .stps{display:flex;align-items:center;margin-bottom:22px}
  .sd{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:var(--surf3);border:2px solid var(--bdr2);color:var(--muted);transition:all .2s}
  .sd.act{background:var(--acc);border-color:var(--acc);color:#fff}
  .sd.dn{background:var(--grn);border-color:var(--grn);color:#000;font-size:15px}
  .sl{flex:1;height:2px;background:var(--bdr2);margin:0 4px;transition:background .2s}
  .sl.dn{background:var(--grn)}

  /* ── SHOPPING ── */
  .shr{padding:14px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .shr:last-child{border-bottom:none}
  .shn{font-size:15px;font-weight:700;color:#fff}
  .shp{font-size:12px;color:var(--muted);margin-top:4px;line-height:1.65}
  .shw{text-align:right;flex-shrink:0}
  .shb{font-family:var(--fd);font-size:24px;color:var(--acc);line-height:1}
  .sho{font-size:12px;color:var(--txt2);margin-top:1px}

  /* ── COOKING INSTRUCTIONS ── */
  .inb{background:#111;border-left:3px solid var(--acc);border-radius:10px;padding:14px;margin-top:10px}
  .inc{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}
  .ich{padding:5px 12px;background:rgba(255,77,0,.12);border-radius:6px;font-size:12px;font-weight:700;color:var(--acc)}
  .int{font-size:14px;color:var(--txt2);line-height:1.65}

  /* ── PORTION TABLE ── */
  .pt2{width:100%;border-collapse:collapse;margin-top:8px}
  .pt2 th{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);padding:10px 0;text-align:left;border-bottom:1px solid var(--bdr)}
  .pt2 td{padding:12px 0;font-size:14px;color:var(--txt2);border-bottom:1px solid var(--bdr)}
  .pt2 tr:last-child td{border-bottom:none}
  .pv{font-family:var(--fd);font-size:22px;color:var(--acc)}
  .pv2{font-family:var(--fd);font-size:22px;color:var(--acc2)}
  .pu{font-size:11px;color:var(--muted);margin-left:3px}

  /* ── CONTAINER LABELS ── */
  .lp{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:10px;border:2px dashed #bbb}
  .lpn{font-family:var(--fd);font-size:26px;color:#111;letter-spacing:1px}
  .lpr{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
  .lpi{font-size:13px;color:#555}
  .lpi b{color:#111}

  /* ── HISTORY ROWS ── */
  .hi{
    display:flex;align-items:center;justify-content:space-between;
    padding:14px;background:var(--surf3);border-radius:12px;
    margin-bottom:8px;border:1px solid var(--bdr2);cursor:pointer;
    -webkit-tap-highlight-color:transparent;
    min-height:56px;
  }
  .hi:active{background:var(--surf2)}

  /* ── AUTH SCREEN ── */
  .auth-wrap{
    min-height:100vh;min-height:-webkit-fill-available;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:24px;padding-bottom:calc(24px + var(--safe-bot));
    background:var(--bg);
  }
  .auth-card{width:100%;max-width:400px;background:var(--surf2);border:1px solid var(--bdr);border-radius:20px;padding:32px 24px}
  .auth-logo{display:flex;justify-content:center;margin-bottom:20px}
  .auth-logo img{height:80px;width:auto;filter:drop-shadow(0 0 8px rgba(0,0,0,.6))}
  .auth-title{font-family:var(--fd);font-size:28px;text-align:center;color:#fff;letter-spacing:1px;margin-bottom:4px}
  .auth-sub{font-size:12px;color:var(--muted);text-align:center;margin-bottom:22px;letter-spacing:2px;text-transform:uppercase}
  .auth-tabs{display:flex;gap:0;margin-bottom:20px;background:var(--surf3);border-radius:10px;padding:3px}
  .auth-tab{flex:1;padding:11px;text-align:center;font-size:14px;font-weight:600;border-radius:8px;cursor:pointer;color:var(--muted);transition:all .15s;min-height:44px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
  .auth-tab.active{background:var(--acc);color:#fff}
  .auth-err{background:rgba(255,23,68,.1);border:1px solid rgba(255,23,68,.4);color:#ff8099;border-radius:10px;padding:12px 14px;font-size:14px;margin-bottom:12px}
  .auth-ok{background:rgba(0,230,118,.08);border:1px solid rgba(0,230,118,.3);color:var(--grn);border-radius:10px;padding:12px 14px;font-size:14px;margin-bottom:12px}
  .signout-btn{font-size:12px;font-weight:700;color:var(--muted);background:transparent;border:1px solid var(--bdr);border-radius:8px;padding:7px 12px;cursor:pointer;letter-spacing:.5px;-webkit-tap-highlight-color:transparent;min-height:36px}
  .signout-btn:active{opacity:.6}

  /* ── MISC ── */
  .div{height:1px;background:var(--bdr);margin:14px 0}
  input[type=range]{
    width:100%;accent-color:var(--acc);cursor:pointer;
    /* Bigger track for thumb */
    height:28px;
  }
  textarea.inp{resize:none;min-height:88px;line-height:1.55}
  /* Hide scrollbar on mobile (still scrollable) */
  ::-webkit-scrollbar{width:0;height:0}

  /* EXPORT BUTTON */
  .export-bar{display:flex;gap:8px;margin:18px 0 4px;flex-wrap:wrap}
  .btn-export{
    display:inline-flex;align-items:center;gap:6px;
    padding:10px 16px;border-radius:8px;font-family:var(--fb);
    font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
    cursor:pointer;border:1.5px solid rgba(255,77,0,.5);
    background:rgba(255,77,0,.08);color:var(--acc);
    transition:all .15s;white-space:nowrap;
  }
  .btn-export:hover{background:rgba(255,77,0,.18);border-color:var(--acc)}
  .btn-export.full{border-color:var(--grn);background:rgba(0,230,118,.08);color:var(--grn)}
  .btn-export.full:hover{background:rgba(0,230,118,.18)}

  /* PRINT STYLES */
  @media print {
    body{background:#fff!important;color:#000!important}
    .hdr,.nav,.btn,.btn-export,.export-bar,.banner,.nt-dot{display:none!important}
    .app{max-width:100%;padding:0}
    .page{padding:12px 16px}
    .card{background:#f9f9f9!important;border:1px solid #ddd!important;break-inside:avoid;margin-bottom:10px}
    .pt{color:#000!important;font-size:26px}
    .pt span{color:#c93a00!important}
    .mc{background:#f0f0f0!important;border:1px solid #ccc!important}
    .mc .v{color:#c93a00!important}
    .al{break-inside:avoid}
    .print-only{display:block!important}
    .no-print{display:none!important}
    .lp{background:#fff!important;border:2px dashed #999!important}
    .lpn{color:#000!important}
    .shn{color:#000!important}
    .shb{color:#c93a00!important}
    .pv{color:#c93a00!important}
    .pv2{color:#c03800!important}
    input[type=range]{display:none}
    .inb{background:#f5f5f5!important;border-left:3px solid #c93a00!important}
    .int{color:#333!important}
    .ich{background:#ffe0d0!important;color:#c93a00!important}
    .print-header{display:flex!important;justify-content:space-between;align-items:center;
      padding:10px 0 14px;border-bottom:2px solid #c93a00;margin-bottom:16px}
  }
  .print-only{display:none}
  .print-header{display:none}
`;

// ─── EXPORT UTILITIES ─────────────────────────────────────────────────────────

const EXPORT_DATE = () => new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

// PDF colour palette
const PDF_BG    = '#f7f7f2';
const PDF_TEXT  = '#111111';
const PDF_BLUE  = '#1a4a8a';
const PDF_MUTED = '#444455';
const PDF_BORDER= '#cccccc';

function buildExportHTML(cardsHTML, title, data) {
  const date     = EXPORT_DATE();
  const users    = data?.users || [];
  const userLine = users.length ? users.map(u=>`${u.name}${u.days?' · '+u.days+'d':'​'}`).join('  |  ') : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>KISSS MEALS — ${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:${PDF_BG};color:${PDF_TEXT};font-size:13px;line-height:1.6;padding:32px 28px}
.doc-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${PDF_BLUE};padding-bottom:14px;margin-bottom:24px}
.doc-logo{font-family:Arial Black,sans-serif;font-size:26px;font-weight:900;color:${PDF_BLUE};letter-spacing:2px}
.doc-meta{text-align:right;font-size:11px;color:${PDF_MUTED};line-height:1.7}
.doc-meta .stitle{font-size:15px;font-weight:700;color:${PDF_TEXT}}
h2{font-size:16px;font-weight:700;color:${PDF_BLUE};border-bottom:1.5px solid ${PDF_BLUE};padding-bottom:6px;margin:20px 0 12px}
.card{background:#fff;border:1px solid ${PDF_BORDER};border-radius:8px;padding:14px 16px;margin-bottom:10px;page-break-inside:avoid}
*{color:${PDF_TEXT}!important;background-color:transparent!important}
.card{background:#fff!important}
body{background:${PDF_BG}!important}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${PDF_MUTED}!important;padding:6px 0;text-align:left;border-bottom:1.5px solid ${PDF_BORDER}}
td{padding:8px 0;font-size:12px;border-bottom:1px solid ${PDF_BORDER}}
tr:last-child td{border-bottom:none}
.lp{background:#fff!important;border:2px dashed #999!important;border-radius:8px;padding:12px 14px;margin-bottom:8px}
.al,.ar,.ag,.ao,.ay{background:#eef2fa!important;border:1px solid #c0cce8!important;border-radius:6px;padding:10px 12px;margin-bottom:8px}
.inb{background:#f0f4fb!important;border-left:3px solid ${PDF_BLUE};border-radius:6px;padding:12px;margin-top:8px}
.ich{display:inline-block;background:#dde6f5!important;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:700;margin-right:6px}
.doc-footer{margin-top:32px;border-top:1px solid ${PDF_BORDER};padding-top:10px;font-size:10px;color:${PDF_MUTED}!important;text-align:center}
</style></head><body>
<div class="doc-header">
  <div class="doc-logo">KISSS MEALS</div>
  <div class="doc-meta">
    <div class="stitle">${title}</div>
    <div>${date}</div>
    ${userLine ? `<div style="margin-top:4px">${userLine}</div>` : ''}
  </div>
</div>
${cardsHTML}
<div class="doc-footer">KISSS MEALS · ${date} · Meal Prep Planner for Simple Shred</div>
</body></html>`;
}

function extractCardsHTML(sectionId, sectionLabel) {
  const el = document.getElementById(sectionId);
  if (!el) return '';
  let html = sectionLabel ? `<h2>${sectionLabel}</h2>` : '';
  el.querySelectorAll('.card').forEach(card => {
    const clone = card.cloneNode(true);
    clone.querySelectorAll('.no-print,.btn,.btn-export,.export-bar,.pg,.banner,.stps,.or,.nt-dot').forEach(x=>x.remove());
    html += `<div class="card">${clone.innerHTML}</div>`;
  });
  return html;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function renderHTMLToPDF(htmlContent, filename) {
  // Load libraries
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');

  // Render in hidden iframe
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:5000px;border:none;visibility:hidden';
  document.body.appendChild(iframe);
  const iDoc = iframe.contentDocument;
  iDoc.open(); iDoc.write(htmlContent); iDoc.close();
  await new Promise(r => setTimeout(r, 900));

  const canvas = await iframe.contentWindow.html2canvas(iDoc.body, {
    scale: 1.8, useCORS: true, backgroundColor: '#f7f7f2',
    windowWidth: 820, logging: false,
  });
  iframe.remove();

  const { jsPDF } = window.jspdf;
  const pdf  = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
  const pw   = pdf.internal.pageSize.getWidth();
  const ph   = pdf.internal.pageSize.getHeight();
  const imgH = (canvas.height / canvas.width) * pw;
  let posY = 0, remaining = imgH;
  const imgData = canvas.toDataURL('image/jpeg', 0.93);
  while (remaining > 0) {
    pdf.addImage(imgData, 'JPEG', 0, -posY, pw, imgH);
    remaining -= ph; posY += ph;
    if (remaining > 0) pdf.addPage();
  }

  const blob = pdf.output('blob');
  const file = new File([blob], filename, { type:'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files:[file] })) {
    await navigator.share({ files:[file], title:'KISSS MEALS' });
  } else {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href:url, download:filename });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
}

async function triggerExport(sectionId, label, data) {
  const cardsHTML = extractCardsHTML(sectionId, label);
  const html = buildExportHTML(cardsHTML, label, data);
  const fname = `KISSS-${label.replace(/[^a-z0-9]/gi,'-')}-${new Date().toISOString().slice(0,10)}.pdf`;
  await renderHTMLToPDF(html, fname);
}

async function triggerFullExport(data) {
  const sections = [
    { id:'section-shopping',   label:'🛒 Shopping List' },
    { id:'section-cooking',    label:'🍳 Cooking Instructions' },
    { id:'section-portioning', label:'⚖️ Portioning Guide' },
    { id:'section-storage',    label:'📦 Storage & Tips' },
  ];
  let all = '';
  sections.forEach(({ id, label }) => { all += extractCardsHTML(id, label); });
  const html  = buildExportHTML(all, 'Full Prep Cycle Export', data);
  const fname = `KISSS-Full-Cycle-${new Date().toISOString().slice(0,10)}.pdf`;
  await renderHTMLToPDF(html, fname);
}

function ExportBar({ sectionId, label, showFull, onFullExport, data }) {
  const [busy, setBusy] = React.useState(false);
  const run = async fn => { setBusy(true); try { await fn(); } catch(e){ console.error(e); } finally { setBusy(false); } };
  return (
    <div className="export-bar no-print" style={{marginBottom:16,marginTop:0}}>
      <button className="btn-export" disabled={busy}
        onClick={()=>run(()=>triggerExport(sectionId, label, data))}>
        {busy?'⏳ Generating...':'📄 Save PDF'}
      </button>
      {showFull&&(
        <button className="btn-export full" disabled={busy}
          onClick={()=>run(()=>triggerFullExport(data))}>
          {busy?'⏳ Building...':'📦 Full Cycle PDF'}
        </button>
      )}
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────

function Steps({ cur, total }) {
  return (
    <div className="stps">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{ display: "contents" }}>
          <div className={`sd ${i < cur ? "dn" : i === cur ? "act" : ""}`}>{i < cur ? "✓" : i + 1}</div>
          {i < total - 1 && <div className={`sl ${i < cur ? "dn" : ""}`} />}
        </span>
      ))}
    </div>
  );
}

function MR({ cals, protein, carbs, fat }) {
  return (
    <div className="mr">
      <div className="mc hl"><div className="v">{cals}</div><div className="l">Kcal</div></div>
      <div className="mc"><div className="v">{protein}g</div><div className="l">Protein</div></div>
      <div className="mc"><div className="v">{carbs}g</div><div className="l">Carbs</div></div>
      <div className="mc"><div className="v">{fat}g</div><div className="l">Fat</div></div>
    </div>
  );
}

// ─── MODULE 1 ─────────────────────────────────────────────────────────────────

function UserSetup({ data, setData, onComplete, onSaveProfile, onDeleteProfile, onBack }) {
  const [view, setView]   = useState("home");
  const [editing, setEditing] = useState(null);
  const [pStep, setPStep] = useState(0);
  const [gStep, setGStep] = useState(0);
  const [f, setF]         = useState(blank());
  const [rf, setRf]       = useState({ days: data.round?.days || 5, mealsPerDay: data.round?.mealsPerDay || 1 });

  function blank() {
    return { name:"", age:"", gender:"", macroMode:null, protein:"", carbs:"", fat:"", activity:"", goal:"", weight:"", proteinG:"", carbPct:"50", restrictions:["None"], days:"5", mealsPerDay:"1" };
  }
  function up(k, v) { setF(p => ({ ...p, [k]: v })); }

  // ── Computed ──
  const knowCals = f.macroMode === "know"
    ? Math.round((+f.protein||0)*4 + (+f.carbs||0)*4 + (+f.fat||0)*9) : 0;

  const tdee = (f.gender && f.weight && f.age && f.activity)
    ? estimateTDEE(f.gender, f.weight, f.age, f.activity) : null;

  const calGoalMap = { cut: tdee ? Math.round(tdee-400) : null, maintain: tdee ? Math.round(tdee) : null, bulk: tdee ? Math.round(tdee+250) : null };
  const calGoal = f.goal ? calGoalMap[f.goal] : null;

  const pMin = f.gender && f.weight ? Math.round(+f.weight * (f.gender==="female" ? 0.75 : 0.85)) : 0;
  const pMax = f.gender && f.weight ? Math.round(+f.weight * (f.gender==="female" ? 0.85 : 1.2))  : 0;

  const protCals  = +f.proteinG ? +f.proteinG * 4 : 0;
  const remaining = calGoal ? calGoal - protCals : 0;
  const cpct      = +f.carbPct || 50;
  const fpct      = 100 - cpct;
  const carbG     = remaining > 0 ? Math.round((remaining * cpct/100) / 4) : 0;
  const fatG      = remaining > 0 ? Math.round((remaining * fpct/100) / 9) : 0;

  function toggleR(r) {
    if (r==="None") { up("restrictions",["None"]); return; }
    let c = (f.restrictions||["None"]).filter(x => x!=="None");
    c = c.includes(r) ? c.filter(x=>x!==r) : [...c,r];
    up("restrictions", c.length===0 ? ["None"] : c);
  }

  function startNew() { setF(blank()); setEditing(null); setPStep(0); setGStep(0); setView("form"); }
  function startEdit(u) {
    setF({ name:u.name, age:u.age, gender:u.gender||"", macroMode:u.macroMode||"know",
           protein:u.protein, carbs:u.carbs, fat:u.fat,
           activity:u.activity||"", goal:u.goal_raw||"", weight:u.weight||"",
           proteinG:u.proteinG||u.protein, carbPct:u.carbPct||"50",
           restrictions:u.restrictions||["None"],
           days:u.days||"5", mealsPerDay:u.mealsPerDay||"1" });
    setEditing(u); setPStep(0); setGStep(0); setView("form");
  }

  async function saveUser() {
    let p2, c2, fa2, cal2, gl;
    if (f.macroMode==="know") {
      p2=f.protein; c2=f.carbs; fa2=f.fat; cal2=String(knowCals); gl="Custom";
    } else {
      p2=String(Math.round(+f.proteinG)); c2=String(carbG); fa2=String(fatG);
      cal2=String(calGoal); gl={cut:"Fat Loss",bulk:"Muscle Gain",maintain:"Maintenance"}[f.goal]||"Maintenance";
    }
    let u = { ...f, protein:p2, carbs:c2, fat:fa2, cals:cal2, goal:gl, goal_raw:f.goal,
              tdee:tdee?String(tdee):"", days:f.days||"5", mealsPerDay:f.mealsPerDay||"1",
              id:editing?.id||String(Date.now()), meal:editing?.meal||initMeal(),
              _dbId: editing?._dbId || null };
    // Save to Supabase if handler provided
    if (onSaveProfile) u = await onSaveProfile(u);
    const users = editing ? data.users.map(x=>x.id===u.id?u:x) : [...data.users,u];
    setData({ ...data, users }); scrollToTop(); setView("home");
  }

  function saveRound() { setData({ ...data, round: rf }); scrollToTop(); setView("home"); }

  // ── Round view ──
  if (view==="cycle") {
    const total = rf.days * rf.mealsPerDay;
    return (
      <div className="page">
        <div className="pt">PREP <span>CYCLE</span></div>
        <div className="ps">Set the length and frequency of this prep cycle.</div>
        {(data.history||[]).length>0 && (
          <div className="card">
            <div className="ct">⏱ Past Cycles</div>
            {data.history.slice(0,3).map((h,i)=>(
              <div key={i} className="hi" onClick={()=>setRf({days:h.days,mealsPerDay:h.mealsPerDay})}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{h.days} days · {h.mealsPerDay} meal{h.mealsPerDay>1?"s":""}/day</div>
                  <div style={{fontSize:11,color:"var(--muted)"}}>{h.date}</div>
                </div>
                <span style={{color:"var(--acc)",fontSize:12,fontWeight:700}}>USE ›</span>
              </div>
            ))}
          </div>
        )}
        <div className="card">
          <div className="ct">Cycle Settings</div>
          <label className="lbl">Number of Days (max 7)</label>
          <input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" min={1} max={7} value={rf.days}
            onChange={e=>setRf({...rf,days:Math.min(7,parseInt(e.target.value)||1)})} />
          {rf.days>7&&<div className="al ar"><span className="ai">⚠️</span>Max 7 days for fridge storage safety.</div>}
          <label className="lbl">Meals Per Day</label>
          <div className="pg">
            {[1,2,3].map(n=>(
              <div key={n} className={`pill ${rf.mealsPerDay===n?"on":""}`} onClick={()=>setRf({...rf,mealsPerDay:n})}>
                {n} meal{n>1?"s":""}
              </div>
            ))}
          </div>
          <div style={{background:"rgba(255,77,0,.07)",border:"1px solid rgba(255,77,0,.25)",borderRadius:10,padding:"14px",marginTop:12}}>
            <div style={{fontSize:12,color:"var(--muted)"}}>Default for new users</div>
            <div style={{fontFamily:"var(--fd)",fontSize:44,color:"var(--acc)",lineHeight:1}}>{total}</div>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>
              {rf.days} day{rf.days!==1?"s":""} × {rf.mealsPerDay} meal{rf.mealsPerDay>1?"s":""}/day — overrideable per user
            </div>
          </div>
        </div>

        {/* Storage + Tupperware summary */}
        {data.users.length > 0 && (()=>{
          const nUsers   = data.users.length;
          const nDays    = rf.days;
          const nMpd     = rf.mealsPerDay;
          const nTotal   = nUsers * nDays * nMpd;
          // Estimate container footprint: typical 3-cup meal prep container ≈ 7" × 5" × 2.5"
          // A standard fridge shelf is about 18"W × 15"D
          const contsPerShelf = Math.floor((18/7) * (15/5)); // ~6 per shelf, conservative
          const shelvesNeeded = Math.ceil(nTotal / contsPerShelf);
          return (
            <div className="card" style={{border:"1.5px solid rgba(0,230,118,.3)"}}>
              <div className="ct" style={{color:"var(--grn)"}}>📦 Storage & Container Estimate</div>

              <div style={{display:"flex",gap:10,marginBottom:14}}>
                <div style={{flex:1,background:"var(--surf3)",border:"1px solid var(--bdr2)",borderRadius:8,padding:"12px",textAlign:"center"}}>
                  <div style={{fontFamily:"var(--fd)",fontSize:32,color:"var(--grn)",lineHeight:1}}>{nTotal}</div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>CONTAINERS NEEDED</div>
                </div>
                <div style={{flex:1,background:"var(--surf3)",border:"1px solid var(--bdr2)",borderRadius:8,padding:"12px",textAlign:"center"}}>
                  <div style={{fontFamily:"var(--fd)",fontSize:32,color:"var(--acc2)",lineHeight:1}}>{shelvesNeeded}</div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>FRIDGE SHELF{shelvesNeeded!==1?"S":""}</div>
                </div>
              </div>

              {[
                `You'll need ${nTotal} meal prep containers (one per person per meal per day).`,
                `A standard fridge shelf fits ~${contsPerShelf} containers side-by-side — plan for ${shelvesNeeded} shelf${shelvesNeeded!==1?"s":""}.`,
                `Recommended container size: 3–4 cup (28–32oz) for a full protein + carb + veggie meal.`,
                `Stack containers vertically to save space — glass stacks more securely than plastic.`,
                `Dedicate one full shelf per ${Math.ceil(nTotal/shelvesNeeded)} containers and keep them front-accessible.`,
              ].map((t,i)=>(
                <div key={i} style={{fontSize:12,color:"var(--txt2)",padding:"6px 0",borderBottom:i<4?"1px solid var(--bdr)":"none",lineHeight:1.6}}>
                  · {t}
                </div>
              ))}
            </div>
          );
        })()}

        <button className="btn bp" onClick={saveRound}>✓ Confirm Cycle</button>
        <button className="btn bg" onClick={()=>{scrollToTop();setView("home")}}>← Back</button>
      </div>
    );
  }

  // ── Profile form ──
  if (view==="form") {
    const isEdit = !!editing;

    // Step 0: Basics
    if (pStep===0) return (
      <div className="page">
        <div className="pt">{isEdit?<>EDIT <span>PROFILE</span></>:<>NEW <span>USER</span></>}</div>
        <div className="ps">Step 1 of 4 — Enter basic info.</div>
        <Steps cur={0} total={4}/>
        <div className="banner"><span>⚡</span><span>Fill in name, age, and sex to continue.</span></div>
        <div className="card">
          <div className="ct">Basic Info</div>
          <label className="lbl">Full Name</label>
          <input className="inp" placeholder="Enter name" value={f.name} onChange={e=>up("name",e.target.value)}/>
          <label className="lbl">Age</label>
          <input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 28" value={f.age} onChange={e=>up("age",e.target.value)}/>
          <label className="lbl">Sex</label>
          <div style={{display:"flex",gap:10}}>
            {["male","female"].map(g=>(
              <div key={g} className={`oc ${f.gender===g?"sel":""}`} style={{flex:1}} onClick={()=>up("gender",g)}>
                <div className="or"/><div className="ob"><div className="on2">{g.charAt(0).toUpperCase()+g.slice(1)}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="ct">Prep Cycle — {f.name || "This User"}</div>
          <label className="lbl">Days to prep</label>
          <input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" min={1} max={7} placeholder="e.g. 5" value={f.days} onChange={e=>up("days", e.target.value.replace(/[^0-9]/g,""))}/>
          {(+f.days > 7) && <div className="al ar" style={{marginTop:-8,marginBottom:8}}><span className="ai">⚠️</span><span>Max 7 days recommended for fridge storage.</span></div>}
          <label className="lbl">Meals per day</label>
          <div className="pg">
            {["1","2","3"].map(n=>(
              <div key={n} className={`pill ${f.mealsPerDay===n?"on":""}`} onClick={()=>up("mealsPerDay",n)}>{n} meal{n!=="1"?"s":""}</div>
            ))}
          </div>
          <div style={{fontSize:12,color:"var(--muted)",marginTop:6}}>
            = <strong style={{color:"var(--acc)"}}>{(+f.days||0)*(+f.mealsPerDay||0)}</strong> total containers for {f.name||"this user"}
          </div>
        </div>
        <button className="btn bp" disabled={!f.name||!f.age||!f.gender||!f.days||!f.mealsPerDay} onClick={()=>{scrollToTop();setPStep(1)}}>Next →</button>
        <button className="btn bg" onClick={()=>{scrollToTop();setView("home")}}>Cancel</button>
      </div>
    );

    // Step 1: Macro mode
    if (pStep===1) return (
      <div className="page">
        <div className="pt">MACRO <span>SETUP</span></div>
        <div className="ps">Step 2 of 4 — How should we set {f.name}'s nutrition targets?</div>
        <Steps cur={1} total={4}/>
        <div className="banner"><span>⚡</span><span>Choose whether to enter your own macros or let us calculate them.</span></div>
        <div className={`oc ${f.macroMode==="know"?"sel":""}`} onClick={()=>up("macroMode","know")}>
          <div className="or"/><div className="ob">
            <div className="on2">I know my macros</div>
            <div className="om">I'll enter protein, carbs & fat targets directly</div>
          </div>
        </div>
        <div className={`oc ${f.macroMode==="guide"?"sel":""}`} onClick={()=>up("macroMode","guide")}>
          <div className="or"/><div className="ob">
            <div className="on2">Help me figure out my macros</div>
            <div className="om">We'll estimate your TDEE and build targets based on your body & goal</div>
          </div>
        </div>
        <button className="btn bp" disabled={!f.macroMode} onClick={()=>{scrollToTop();setPStep(2)}}>Next →</button>
        <button className="btn bg" onClick={()=>{scrollToTop();setPStep(0)}}>← Back</button>
      </div>
    );

    // Step 2A: Know macros
    if (pStep===2 && f.macroMode==="know") return (
      <div className="page">
        <div className="pt">ENTER <span>MACROS</span></div>
        <div className="ps">Step 3 of 4 — Enter daily targets. Calories auto-calculate.</div>
        <Steps cur={2} total={4}/>
        <div className="banner"><span>⚡</span><span>Enter protein, carbs & fat. Calories will be shown automatically.</span></div>
        <div className="card">
          <div className="ct">Daily Targets</div>
          <div className="ig">
            <div><label className="lbl">Protein (g)</label><input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" placeholder="180" value={f.protein} onChange={e=>up("protein",e.target.value)}/></div>
            <div><label className="lbl">Carbs (g)</label><input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" placeholder="220" value={f.carbs} onChange={e=>up("carbs",e.target.value)}/></div>
            <div><label className="lbl">Fat (g)</label><input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" placeholder="65" value={f.fat} onChange={e=>up("fat",e.target.value)}/></div>
          </div>
          {(f.protein||f.carbs||f.fat)&&(
            <div style={{background:"rgba(255,77,0,.07)",border:"1px solid rgba(255,77,0,.25)",borderRadius:8,padding:"14px"}}>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:2}}>Calculated daily calories (read-only)</div>
              <div style={{fontFamily:"var(--fd)",fontSize:42,color:"var(--acc)",lineHeight:1}}>{knowCals} <span style={{fontSize:14,color:"var(--muted)"}}>kcal</span></div>
              <div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>({f.protein||0}g×4) + ({f.carbs||0}g×4) + ({f.fat||0}g×9)</div>
            </div>
          )}
        </div>
        <button className="btn bp" disabled={!f.protein||!f.carbs||!f.fat} onClick={()=>{scrollToTop();setPStep(3)}}>Next →</button>
        <button className="btn bg" onClick={()=>{scrollToTop();setPStep(1)}}>← Back</button>
      </div>
    );

    // Step 2B: Guided — sub-steps
    if (pStep===2 && f.macroMode==="guide") {

      // gStep 0: Activity
      if (gStep===0) return (
        <div className="page">
          <div className="pt">ACTIVITY <span>LEVEL</span></div>
          <div className="ps">Step 3 of 4 — Used to estimate daily calorie burn (TDEE).</div>
          <Steps cur={2} total={4}/>
          <div className="banner"><span>⚡</span><span>Pick the option that best describes {f.name}'s typical day.</span></div>
          {[
            {id:"low",    label:"Low",    desc:"Desk job, little or no exercise. Mostly sitting throughout the day."},
            {id:"medium", label:"Medium", desc:"Light exercise 3–5x/week, or an active job (retail, teaching, nursing)."},
            {id:"high",   label:"High",   desc:"Intense exercise 6–7x/week, physical labor job, or twice-daily training."},
          ].map(a=>(
            <div key={a.id} className={`oc ${f.activity===a.id?"sel":""}`} onClick={()=>up("activity",a.id)}>
              <div className="or"/><div className="ob"><div className="on2">{a.label}</div><div className="om">{a.desc}</div></div>
            </div>
          ))}
          <button className="btn bp" disabled={!f.activity} onClick={()=>{scrollToTop();setGStep(1)}}>Next →</button>
          <button className="btn bg" onClick={()=>{scrollToTop();setPStep(1)}}>← Back</button>
        </div>
      );

      // gStep 1: Weight → TDEE
      if (gStep===1) return (
        <div className="page">
          <div className="pt">BODY <span>WEIGHT</span></div>
          <div className="ps">Step 3 of 4 — Used to estimate calorie needs and set protein targets.</div>
          <Steps cur={2} total={4}/>
          <div className="banner"><span>⚡</span><span>Enter current weight in pounds to calculate TDEE.</span></div>
          <div className="card">
            <label className="lbl">Current Weight (lbs)</label>
            <input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 175" value={f.weight} onChange={e=>up("weight",e.target.value)}/>
            {f.weight&&tdee&&(
              <div style={{background:"rgba(255,77,0,.07)",border:"1px solid rgba(255,77,0,.25)",borderRadius:8,padding:"14px"}}>
                <div style={{fontSize:11,color:"var(--muted)"}}>Estimated TDEE</div>
                <div style={{fontFamily:"var(--fd)",fontSize:42,color:"var(--acc)",lineHeight:1.1}}>{tdee} <span style={{fontSize:14,color:"var(--muted)"}}>kcal/day</span></div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:5}}>Calories burned daily at your activity level — your maintenance baseline.</div>
              </div>
            )}
          </div>
          <button className="btn bp" disabled={!f.weight} onClick={()=>{scrollToTop();setGStep(2)}}>Next →</button>
          <button className="btn bg" onClick={()=>{scrollToTop();setGStep(0)}}>← Back</button>
        </div>
      );

      // gStep 2: Goal
      if (gStep===2) return (
        <div className="page">
          <div className="pt">CALORIE <span>GOAL</span></div>
          <div className="ps">Based on TDEE of {tdee} kcal/day — choose a goal.</div>
          <Steps cur={2} total={4}/>
          <div className="banner"><span>⚡</span><span>Select a goal to set {f.name}'s calorie target.</span></div>
          {[
            {id:"cut",      label:"Cut — Fat Loss",    desc:`TDEE − 400 → ${tdee?tdee-400:"?"} kcal/day. Steady, sustainable deficit.`},
            {id:"maintain", label:"Maintain",          desc:`Stay at TDEE → ${tdee||"?"} kcal/day. Body composition focus.`},
            {id:"bulk",     label:"Bulk — Muscle Gain",desc:`TDEE + 250 → ${tdee?tdee+250:"?"} kcal/day. Lean gaining surplus.`},
          ].map(g=>(
            <div key={g.id} className={`oc ${f.goal===g.id?"sel":""}`} onClick={()=>up("goal",g.id)}>
              <div className="or"/><div className="ob"><div className="on2">{g.label}</div><div className="om">{g.desc}</div></div>
            </div>
          ))}
          {f.goal&&calGoal&&(
            <div className="al ao"><span className="ai">🎯</span>
              <span>Daily calorie target: <strong style={{color:"#fff"}}>{calGoal} kcal</strong></span>
            </div>
          )}
          <button className="btn bp" disabled={!f.goal} onClick={()=>{scrollToTop();setGStep(3)}}>Next →</button>
          <button className="btn bg" onClick={()=>{scrollToTop();setGStep(1)}}>← Back</button>
        </div>
      );

      // gStep 3: Protein + split
      if (gStep===3) return (
        <div className="page">
          <div className="pt">MACRO <span>SPLIT</span></div>
          <div className="ps">Set protein first, then split remaining calories between carbs and fat.</div>
          <Steps cur={2} total={4}/>
          <div className="banner"><span>⚡</span><span>Enter protein target, then adjust the carb/fat slider.</span></div>

          <div className="card">
            <div className="ct">1 — Daily Protein Target</div>
            <div className="al ao" style={{marginBottom:12}}>
              <span className="ai">💪</span>
              <div>
                Recommended for {f.name}: <strong style={{color:"#fff"}}>{pMin}–{pMax}g/day</strong><br/>
                <span style={{fontSize:11}}>({f.gender==="female"?"0.75–0.85":"0.85–1.2"}g × {f.weight} lbs bodyweight)</span>
              </div>
            </div>
            <label className="lbl">Protein (g/day)</label>
            <input className="inp" type="number" inputMode="numeric" pattern="[0-9]*" placeholder={`${pMin}–${pMax}g`} value={f.proteinG} onChange={e=>up("proteinG",e.target.value)}/>
            {f.proteinG&&<div style={{fontSize:12,color:"var(--muted)"}}>{f.proteinG}g × 4 = <strong style={{color:"var(--txt2)"}}>{Math.round(+f.proteinG*4)} kcal</strong> from protein</div>}
          </div>

          {f.proteinG&&remaining>0&&(
            <div className="card">
              <div className="ct">2 — Carb vs Fat Split</div>
              <div style={{fontSize:13,color:"var(--txt2)",marginBottom:12}}>
                Remaining to allocate: <strong style={{color:"#fff"}}>{Math.round(remaining)} kcal</strong>
              </div>
              <label className="lbl">Carbs {cpct}% ← slide → Fat {fpct}%</label>
              <input type="range" min={20} max={80} value={cpct} onChange={e=>up("carbPct",e.target.value)} style={{marginBottom:14}}/>
              <MR cals={calGoal} protein={Math.round(+f.proteinG)} carbs={carbG} fat={fatG}/>
            </div>
          )}

          {f.proteinG&&remaining<=0&&(
            <div className="al ar"><span className="ai">⚠️</span>
              <span>Protein intake exceeds calorie goal. Lower protein or adjust your goal.</span>
            </div>
          )}

          <button className="btn bp" disabled={!f.proteinG||remaining<=0} onClick={()=>{scrollToTop();setPStep(3)}}>Next — Dietary Restrictions →</button>
          <button className="btn bg" onClick={()=>{scrollToTop();setGStep(2)}}>← Back</button>
        </div>
      );
    }

    // Step 3: Restrictions + summary
    if (pStep===3) {
      const sp = f.macroMode==="know" ? f.protein : String(Math.round(+f.proteinG||0));
      const sc = f.macroMode==="know" ? f.carbs   : String(carbG);
      const sf = f.macroMode==="know" ? f.fat     : String(fatG);
      const sk = f.macroMode==="know" ? knowCals  : calGoal;
      return (
        <div className="page">
          <div className="pt">DIETARY <span>INFO</span></div>
          <div className="ps">Step 4 of 4 — Restrictions and final confirmation.</div>
          <Steps cur={3} total={4}/>
          <div className="banner"><span>⚡</span><span>Select any dietary restrictions, then review and save the profile.</span></div>
          <div className="card">
            <div className="ct">Dietary Restrictions</div>
            <div className="pg">
              {RESTRICTIONS.map(r=>(
                <div key={r} className={`pill ${(f.restrictions||["None"]).includes(r)?"on":""}`} onClick={()=>toggleR(r)}>{r}</div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="ct">✅ Profile Summary — {f.name}</div>
            <MR cals={sk||0} protein={sp||0} carbs={sc||0} fat={sf||0}/>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>
              {f.age} yrs · {f.gender} · Restrictions: {(f.restrictions||["None"]).join(", ")}
            </div>
          </div>
          <button className="btn bp" onClick={saveUser}>{isEdit?"💾 Save Changes":"➕ Add User"}</button>
          <button className="btn bg" onClick={()=>{scrollToTop();setPStep(2)}}>← Back</button>
        </div>
      );
    }
  }

  // ── Home ──
  const canContinue = data.users.length>0 && !!data.round;
  return (
    <div className="page" id="section-setup">
      <div className="pt">USER <span>SETUP</span></div>
      <div className="ps">Add user profiles and configure your prep cycle before continuing.</div>
      

      {data.users.length===0&&(
        <div className="banner"><span>⚡</span><span>Add at least one user profile to get started.</span></div>
      )}
      {data.users.length>0&&!data.round&&(
        <div className="banner"><span>⚡</span><span>Now configure your prep cycle — tap the card below.</span></div>
      )}

      <div className="card">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div className="ct" style={{marginBottom:0}}>PROFILES ({data.users.length})</div>
          <button className="btn bp bsm" onClick={startNew}>+ Add User</button>
        </div>
        {data.users.length===0&&<div style={{fontSize:13,color:"var(--muted)",textAlign:"center",padding:"18px 0"}}>No users yet.</div>}
        {data.users.map(u=>(
          <div key={u.id} className="ur">
            <div className="uav">{u.name?.[0]?.toUpperCase()||"?"}</div>
            <div className="ui">
              <div className="un">{u.name}</div>
              <div className="usb">{u.goal}{u.cals?` · ${u.cals} kcal`:""}{u.protein?` · P:${u.protein}g`:""}{u.days?` · ${u.days}d/${u.mealsPerDay||1}m`:""}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn bg bsm" onClick={()=>startEdit(u)}>Edit</button>
              <button className="btn bg bsm" style={{color:"#ff6080",borderColor:"rgba(255,23,68,.4)"}}
                onClick={async()=>{
                  if(!window.confirm(`Remove ${u.name} from this account?`)) return;
                  if(onDeleteProfile) await onDeleteProfile(u);
                  setData(prev=>({...prev,users:prev.users.filter(x=>x.id!==u.id)}));
                }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{cursor:"pointer",border:data.round?"1px solid var(--bdr)":"1.5px solid rgba(255,77,0,.5)"}} onClick={()=>{scrollToTop();setView("cycle")}}>
        <div className="ct">PREP CYCLE</div>
        {data.round?(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontFamily:"var(--fd)",fontSize:32,color:"var(--acc)",lineHeight:1}}>{data.round.days}D / {data.round.mealsPerDay}M</div>
              <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>default · set per-user in profiles</div>
              {data.users.length>0 && (
                <div style={{fontSize:11,color:"var(--grn)",marginTop:3}}>
                  {data.users.map(u=>`${u.name}: ${u.days||data.round.days}d/${u.mealsPerDay||data.round.mealsPerDay}m`).join(" · ")}
                </div>
              )}
            </div>
            <span style={{color:"var(--muted)",fontSize:12,fontWeight:700}}>EDIT ›</span>
          </div>
        ):(
          <div style={{fontSize:13,color:"var(--acc)",fontWeight:700}}>⚡ Tap to configure round →</div>
        )}
      </div>

      <button className="btn bp" disabled={!canContinue} onClick={onComplete}>Continue to Meal Selection →</button>
      {onBack && <button className="btn bg" style={{marginTop:8}} onClick={onBack}>← Back to Home</button>}
    </div>
  );
}

const FOOD_DB = {
  "Proteins": [
    { id:"f_chicken",     name:"Chicken Breast, Skinless", serving:"4 oz raw",       protein:35.2,  carbs:0.0,  fat:4.1,  cals:196.2  },
    { id:"f_beef93",      name:"Ground Beef, 93% Lean",    serving:"4 oz raw",       protein:23.6,  carbs:0.0,  fat:13.2, cals:217.7  },
    { id:"f_beef85",      name:"Ground Beef, 85% Lean",    serving:"4 oz raw",       protein:20.8,  carbs:0.0,  fat:20.6, cals:272.2  },
    { id:"f_turkey99",    name:"Ground Turkey, 99% Lean",  serving:"4 oz raw",       protein:26.0,  carbs:0.0,  fat:1.0,  cals:120.0  },
    { id:"f_sirloin",     name:"Top Sirloin Steak",        serving:"4 oz raw",       protein:25.0,  carbs:0.0,  fat:6.0,  cals:160.0  },
    { id:"f_salmon",      name:"Salmon, Wild Caught",      serving:"4 oz raw",       protein:22.0,  carbs:0.0,  fat:7.0,  cals:160.0  },
    { id:"f_cod",         name:"Cod",                      serving:"4 oz raw",       protein:20.0,  carbs:0.0,  fat:0.5,  cals:90.0   },
    { id:"f_tuna",        name:"StarKist Tuna in Water",   serving:"1/3 cup",        protein:16.0,  carbs:0.0,  fat:0.7,  cals:70.0   },
    { id:"f_oikos",       name:"Dannon Oikos Triple Zero", serving:"5.3 oz",         protein:15.0,  carbs:10.0, fat:0.0,  cals:109.0  },
    { id:"f_eggwhites",   name:"Egg Whites, Liquid",       serving:"1/2 cup",        protein:13.0,  carbs:1.0,  fat:0.0,  cals:60.0   },
    { id:"f_whey",        name:"Whey Protein Powder",      serving:"1 scoop",        protein:24.0,  carbs:3.0,  fat:1.0,  cals:115.7  },
    { id:"f_egg",         name:"Eggs, Cooked",             serving:"1 medium",       protein:6.3,   carbs:0.4,  fat:4.8,  cals:68.2   },
  ],
  "Carbohydrates": [
    { id:"f_rice",        name:"White Rice, Steamed",      serving:"1/4 cup",        protein:1.1,   carbs:11.1, fat:0.1,  cals:51.4   },
    { id:"f_russet",      name:"Russet Potato",            serving:"1 medium (6oz)", protein:4.0,   carbs:37.0, fat:0.2,  cals:168.0  },
    { id:"f_quinoa",      name:"Quinoa, Dry",              serving:"1/4 cup",        protein:6.0,   carbs:30.0, fat:2.5,  cals:170.0  },
    { id:"f_oats",        name:"Old Fashioned Rolled Oats",serving:"1/4 cup dry",    protein:2.5,   carbs:13.5, fat:1.5,  cals:75.0   },
    { id:"f_sweetpotato", name:"Sweet Potato, Baked",      serving:"4 oz",           protein:2.3,   carbs:23.5, fat:0.2,  cals:102.1  },
    { id:"f_yukon",       name:"Yukon Gold Potatoes",      serving:"4 oz",           protein:2.0,   carbs:17.8, fat:0.1,  cals:78.9   },
  ],
  "Veggies, Fruits & Snacks": [
    { id:"f_blueberries", name:"Blueberries",              serving:"1 cup",          protein:1.1,   carbs:21.0, fat:0.5,  cals:84.0   },
    { id:"f_banana",      name:"Banana, Fresh",            serving:"1 medium",       protein:1.3,   carbs:27.0, fat:0.4,  cals:103.8  },
    { id:"f_carrots",     name:"Carrots, Cooked",          serving:"1 cup diced",    protein:1.2,   carbs:11.7, fat:0.2,  cals:50.7   },
    { id:"f_broccoli",    name:"Broccoli Florets",         serving:"1 cup",          protein:2.6,   carbs:6.0,  fat:0.3,  cals:31.0   },
    { id:"f_ricecakes",   name:"Rice Cakes, Plain",        serving:"1 cake",         protein:0.7,   carbs:7.0,  fat:0.3,  cals:35.0   },
  ],
  "Healthy Fats": [
    { id:"f_almonds",     name:"Raw Almonds",              serving:"1 oz (~23 nuts)",protein:6.0,   carbs:6.0,  fat:14.0, cals:164.0  },
    { id:"f_avocado",     name:"Avocado",                  serving:"1/2 medium",     protein:1.5,   carbs:6.0,  fat:11.0, cals:120.0  },
    { id:"f_oliveoil",    name:"Extra Virgin Olive Oil",   serving:"1 tbsp",         protein:0.0,   carbs:0.0,  fat:14.0, cals:120.0  },
  ],
};

const FOOD_DB_FLAT = Object.values(FOOD_DB).flat();

// ─── OTHER MEALS SELECTOR ─────────────────────────────────────────────────────

function OtherMealsLookup({ user, savedOtherMeals, onSave, onSkip }) {
  const [phase, setPhase]         = useState("choice");
  const [mealSlots, setMealSlots] = useState({ breakfast: false, dinner: false });
  const [quantities, setQuantities] = useState({ breakfast: {}, dinner: {} });
  const [expandedCat, setExpandedCat] = useState({});


  // ── Helper: compute totals from quantities for a given meal slot ──
  function slotTotals(slot) {
    const q = quantities[slot] || {};
    return Object.entries(q).reduce((acc, [id, count]) => {
      if (!count) return acc;
      const food = FOOD_DB_FLAT.find(f => f.id === id);
      if (!food) return acc;
      return {
        cals:    Math.round(acc.cals    + food.cals    * count),
        protein: Math.round(acc.protein + food.protein * count),
        carbs:   Math.round(acc.carbs   + food.carbs   * count),
        fat:     Math.round(acc.fat     + food.fat     * count),
      };
    }, { cals:0, protein:0, carbs:0, fat:0 });
  }

  function combinedTotals() {
    const b = mealSlots.breakfast ? slotTotals("breakfast") : { cals:0,protein:0,carbs:0,fat:0 };
    const d = mealSlots.dinner    ? slotTotals("dinner")    : { cals:0,protein:0,carbs:0,fat:0 };
    return {
      cals:    Math.round(b.cals    + d.cals),
      protein: Math.round(b.protein + d.protein),
      carbs:   Math.round(b.carbs   + d.carbs),
      fat:     Math.round(b.fat     + d.fat),
    };
  }

  function setQty(slot, id, delta) {
    setQuantities(prev => {
      const cur = (prev[slot]?.[id]) || 0;
      const next = Math.max(0, cur + delta);
      return { ...prev, [slot]: { ...prev[slot], [id]: next } };
    });
  }

  function buildSavePayload() {
    const tot = combinedTotals();
    const daily = { cals:+user.cals||0, protein:+user.protein||0, carbs:+user.carbs||0, fat:+user.fat||0 };
    const rem = {
      cals:    Math.max(0, daily.cals    - tot.cals),
      protein: Math.max(0, daily.protein - tot.protein),
      carbs:   Math.max(0, daily.carbs   - tot.carbs),
      fat:     Math.max(0, daily.fat     - tot.fat),
    };
    const meals = [];
    if (mealSlots.breakfast) meals.push("Breakfast");
    if (mealSlots.dinner)    meals.push("Dinner");

    const items = [];
    ["breakfast","dinner"].forEach(slot => {
      if (!mealSlots[slot]) return;
      Object.entries(quantities[slot]||{}).forEach(([id, count]) => {
        if (!count) return;
        const food = FOOD_DB_FLAT.find(f => f.id === id);
        if (!food) return;
        items.push({
          meal:    slot.charAt(0).toUpperCase()+slot.slice(1),
          name:    food.name,
          serving: food.serving,
          count,
          cals:    food.cals,
          protein: food.protein,
          carbs:   food.carbs,
          fat:     food.fat,
        });
      });
    });

    return { meals, items, ...tot, ...rem, dailyTotal: tot };
  }

  // ── Phase: choice (first time or reuse) ──
  if (phase === "choice") {
    if (savedOtherMeals) {
      const om  = savedOtherMeals;
      const tot = { cals:om.dailyTotal?.cals||om.cals||0, protein:om.dailyTotal?.protein||om.protein||0,
                    carbs:om.dailyTotal?.carbs||om.carbs||0, fat:om.dailyTotal?.fat||om.fat||0 };
      return (
        <div className="page">
          <div className="pt">OTHER MEALS — <span>{user.name}</span></div>
          <div className="ps">Saved data found for {user.name}. Reuse it or update?</div>
          <div className="card">
            <div className="ct">Saved — {om.meals?.join(" + ")||"Other Meals"}</div>
            <MR cals={tot.cals} protein={tot.protein} carbs={tot.carbs} fat={tot.fat}/>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:6,lineHeight:1.7}}>
              {om.items?.map(i=>`${i.count > 1 ? i.count+"× " : ""}${i.name}`).join(" · ")||""}
            </div>
          </div>
          <button className="btn bp" onClick={()=>onSave(savedOtherMeals)}>Use Saved Data →</button>
          <button className="btn bs" onClick={()=>setPhase("select_meals")}>Update Other Meals</button>
          <button className="btn bg" onClick={onSkip}>Skip — Use Full Daily Macros for Lunch</button>
        </div>
      );
    }
    return (
      <div className="page">
        <div className="pt">OTHER <span>MEALS</span></div>
        <div className="ps">Does {user.name} eat breakfast or dinner that should count toward their daily macros?</div>
        <div className="al ao">
          <span className="ai">💡</span>
          <span>Log what {user.name} eats outside of this prepped lunch. The app will deduct those macros from the daily target so the lunch portion is right-sized.</span>
        </div>
        <button className="btn bp" onClick={()=>setPhase("select_meals")}>Yes — Log Other Meals →</button>
        <button className="btn bg" onClick={onSkip}>Skip — Use Full Daily Macros for Lunch</button>
      </div>
    );
  }

  // ── Phase: select which meal slots ──
  if (phase === "select_meals") return (
    <div className="page">
      <div className="pt">OTHER MEALS — <span>{user.name}</span></div>
      <div className="ps">Select the meals {user.name} eats outside of this prepped lunch. You can pick both.</div>
      <div className="card">
        <div className="ct">Select All That Apply</div>
        {[["breakfast","☀️ Breakfast","Morning meal before work/school"],
          ["dinner",   "🌙 Dinner",   "Evening meal after the work day"]].map(([key,label,desc])=>(
          <div key={key} className={`oc ${mealSlots[key]?"sel":""}`}
            onClick={()=>setMealSlots(p=>({...p,[key]:!p[key]}))}>
            <div className="or"/>
            <div className="ob"><div className="on2">{label}</div><div className="om">{desc}</div></div>
          </div>
        ))}
      </div>
      <button className="btn bp"
        disabled={!mealSlots.breakfast && !mealSlots.dinner}
        onClick={()=>setPhase("build")}>
        Next — Log Foods →
      </button>
      <button className="btn bg" onClick={()=>setPhase("choice")}>← Back</button>
    </div>
  );

  // ── Phase: build — food picker with +/- toggles ──
  if (phase === "build") {
    const activeMeals = [
      mealSlots.breakfast && "breakfast",
      mealSlots.dinner    && "dinner",
    ].filter(Boolean);

    return (
      <div className="page">
        <div className="pt">OTHER MEALS — <span>{user.name}</span></div>
        <div className="ps">Tap + for each food {user.name} typically eats. Use the serving size shown. Add multiple servings with repeated +.</div>

        {activeMeals.map(slot => {
          const slotTot = slotTotals(slot);
          const hasAny  = Object.values(quantities[slot]||{}).some(v=>v>0);
          const label   = slot === "breakfast" ? "☀️ Breakfast" : "🌙 Dinner";
          return (
            <div key={slot}>
              {/* Slot header + running total */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                margin:"18px 0 8px",padding:"0 2px"}}>
                <div style={{fontFamily:"var(--fd)",fontSize:20,color:"var(--acc)",letterSpacing:1}}>{label}</div>
                {hasAny && (
                  <div style={{fontSize:11,color:"var(--grn)",fontWeight:700,textAlign:"right"}}>
                    {slotTot.cals} kcal · P:{slotTot.protein}g C:{slotTot.carbs}g F:{slotTot.fat}g
                  </div>
                )}
              </div>

              {Object.entries(FOOD_DB).map(([cat, foods]) => {
                const catKey  = `${slot}_${cat}`;
                const isOpen  = expandedCat[catKey] !== false; // default open
                return (
                  <div key={cat} className="card" style={{marginBottom:10,padding:"12px 14px"}}>
                    {/* Category header */}
                    <div
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}
                      onClick={()=>setExpandedCat(p=>({...p,[catKey]:!isOpen}))}>
                      <div style={{fontSize:12,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:"var(--muted)"}}>{cat}</div>
                      <div style={{fontSize:12,color:"var(--muted)"}}>{isOpen?"▲":"▼"}</div>
                    </div>

                    {isOpen && foods.map(food => {
                      const qty = quantities[slot]?.[food.id] || 0;
                      return (
                        <div key={food.id} style={{
                          display:"flex", alignItems:"center", gap:10,
                          padding:"10px 0", borderTop:"1px solid var(--bdr)",
                          marginTop:8
                        }}>
                          {/* Food info */}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color: qty>0 ? "#fff" : "var(--txt2)",lineHeight:1.3}}>{food.name}</div>
                            <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{food.serving} · {food.protein}g P · {food.carbs}g C · {food.fat}g F</div>
                            {qty > 0 && (
                              <div style={{fontSize:11,color:"var(--grn)",marginTop:2,fontWeight:700}}>
                                {qty > 1 ? `${qty}× = ` : ""}
                                {+(food.cals*qty).toFixed(0)} kcal · P:{+(food.protein*qty).toFixed(1)}g
                              </div>
                            )}
                          </div>

                          {/* +/- controls */}
                          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                            <button
                              onClick={()=>setQty(slot, food.id, -1)}
                              disabled={qty===0}
                              style={{
                                width:32,height:32,borderRadius:"50%",border:"1.5px solid var(--bdr2)",
                                background: qty>0 ? "var(--surf3)" : "transparent",
                                color: qty>0 ? "#fff" : "var(--bdr2)",
                                fontSize:18,fontWeight:700,cursor:qty>0?"pointer":"default",
                                display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1
                              }}>−</button>
                            <div style={{
                              width:28,textAlign:"center",fontFamily:"var(--fd)",fontSize:20,
                              color: qty>0 ? "var(--acc)" : "var(--muted)",lineHeight:1
                            }}>{qty}</div>
                            <button
                              onClick={()=>setQty(slot, food.id, +1)}
                              style={{
                                width:32,height:32,borderRadius:"50%",border:"1.5px solid var(--acc)",
                                background:"rgba(255,77,0,.12)",color:"var(--acc)",
                                fontSize:18,fontWeight:700,cursor:"pointer",
                                display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1
                              }}>+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Combined running total */}
        {(()=>{
          const tot = combinedTotals();
          const daily = { cals:+user.cals||0, protein:+user.protein||0, carbs:+user.carbs||0, fat:+user.fat||0 };
          const rem   = {
            cals:    Math.max(0, daily.cals    - tot.cals),
            protein: Math.max(0, daily.protein - tot.protein),
            carbs:   Math.max(0, daily.carbs   - tot.carbs),
            fat:     Math.max(0, daily.fat     - tot.fat),
          };
          const hasAny = tot.cals > 0;
          return hasAny ? (
            <div style={{position:"sticky",bottom:0,background:"var(--bg)",padding:"12px 0 4px"}}>
              <div className="card" style={{border:"1.5px solid var(--grn)",marginBottom:0}}>
                <div className="ct" style={{color:"var(--grn)",marginBottom:8}}>
                  Running Total — Other Meals
                </div>
                <MR cals={Math.round(tot.cals)} protein={Math.round(tot.protein)} carbs={Math.round(tot.carbs)} fat={Math.round(tot.fat)}/>
                <div style={{height:1,background:"var(--bdr)",margin:"10px 0"}}/>
                <div style={{fontSize:11,color:"var(--muted)",marginBottom:6,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Remaining for Lunch</div>
                <MR cals={Math.round(rem.cals)} protein={Math.round(rem.protein)} carbs={Math.round(rem.carbs)} fat={Math.round(rem.fat)}/>
              </div>
            </div>
          ) : null;
        })()}

        <button className="btn bp"
          style={{marginTop:14}}
          onClick={()=>{ onSave(buildSavePayload()); }}>
          ✓ Save & Calculate Lunch Portions →
        </button>
        <button className="btn bg" onClick={()=>setPhase("select_meals")}>← Back</button>
      </div>
    );
  }

  return null;
}

// ─── MODULE 2 ─────────────────────────────────────────────────────────────────

function ShoppingOptions({ data, setData, onComplete, onBack }) {
  const [activeUser, setActiveUser] = useState(0);
  const [bStep, setBStep]           = useState(0);
  const [showList, setShowList]     = useState(false);
  const [showPantry, setShowPantry] = useState(false);
  const [pantryAmounts, setPantryAmounts] = useState({});  // { itemName: grams }
  const [doingOtherMeals, setDoingOtherMeals] = useState(true);

  // Package size options in oz → converted to grams
  const PACKAGE_SIZES_OZ = [8, 12, 16, 24, 32, 48, 64];
  const ozToG = oz => Math.round(oz * 28.3495);

  const user = data.users[activeUser];
  const meal = user?.meal || initMeal();

  // Remaining macros for this user's lunch (after other meals)
  const om = user?.otherMeals;
  const lunchTargets = om
    ? { cals: om.cals||0, protein: om.protein||0, carbs: om.carbs||0, fat: om.fat||0 }
    : { cals: +user?.cals||0, protein: +user?.protein||0, carbs: +user?.carbs||0, fat: +user?.fat||0 };

  function setMeal(k, v) {
    const users = data.users.map((u,i) => i===activeUser ? { ...u, meal:{ ...u.meal, [k]:v } } : u);
    setData({ ...data, users });
  }

  function saveOtherMeals(omData) {
    const users = data.users.map((u,i) => i===activeUser ? { ...u, otherMeals: omData } : u);
    setData({ ...data, users });
    scrollToTop(); setDoingOtherMeals(false);
    setBStep(0);
  }

  function skipOtherMeals() {
    const users = data.users.map((u,i) => i===activeUser ? { ...u, otherMeals: null } : u);
    setData({ ...data, users });
    scrollToTop();setDoingOtherMeals(false);
    setBStep(0);
  }

  function nextUser() {
    scrollToTop();
    if (activeUser < data.users.length - 1) {
      setActiveUser(activeUser + 1);
      setBStep(0);
      setDoingOtherMeals(true);
    } else {
      setShowPantry(true);
    }
  }

  function switchUser(i) {
    scrollToTop();
    setActiveUser(i);
    setBStep(0);
    const u = data.users[i];
    setDoingOtherMeals(!("otherMeals" in u));
  }

  const allDone = data.users.every(u => u.meal?.protein && u.meal?.carb);

  // ── Other meals flow ──
  if (doingOtherMeals) {
    return (
      <OtherMealsLookup
        user={user}
        savedOtherMeals={user?.otherMeals}
        onSave={saveOtherMeals}
        onSkip={skipOtherMeals}
      />
    );
  }

  // ── Pantry check ──
  if (showPantry) {
    const rawShop = calcRawWeights(data.users, data.round?.days||5);
    return (
      <div className="page">
        <div className="pt">PANTRY <span>CHECK</span></div>
        <div className="ps">Do you already have any of these ingredients on hand? Select package sizes to deduct from your shopping list.</div>
        <div className="al ao">
          <span className="ai">🧊</span>
          <span>Only deduct what you're <strong>confident you have enough of</strong>. Partial packages count — just pick the closest size.</span>
        </div>
        {Object.entries(rawShop).map(([name, val])=>{
          const { g, isProtein } = val;
          const currentDeduct = pantryAmounts[name] || 0;
          const netG = Math.max(0, g - currentDeduct);
          const netOz = gToOz(netG);
          return (
            <div key={name} className="card">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{name}</div>
                  <div style={{fontSize:11,color:"var(--muted)"}}>
                    Need: {formatImperialWeight(g)}
                  </div>
                </div>
                {currentDeduct > 0 && (
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:10,color:"var(--grn)",fontWeight:700}}>−{gToOz(currentDeduct).toFixed(1)} oz on hand</div>
                    <div style={{fontSize:12,fontWeight:700,color:"var(--acc)"}}>
                      Still need: {formatImperialWeight(netG)}
                    </div>
                  </div>
                )}
              </div>
              <label className="lbl" style={{marginBottom:6}}>I already have:</label>
              <div className="pg">
                <div
                  className={`pill ${currentDeduct===0?"on":""}`}
                  onClick={()=>setPantryAmounts(p=>({...p,[name]:0}))}>
                  None
                </div>
                {PACKAGE_SIZES_OZ.filter(oz => ozToG(oz) <= g + ozToG(8)).map(oz=>(
                  <div key={oz}
                    className={`pill ${currentDeduct===ozToG(oz)?"on":""}`}
                    onClick={()=>setPantryAmounts(p=>({...p,[name]:ozToG(oz)}))}>
                    {oz} oz{oz>=16?` (${oz/16} lb)`:""}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <button className="btn bp" onClick={()=>{ setShowPantry(false); scrollToTop();setShowList(true); }}>
          ✓ Apply & View Final List →
        </button>
        <button className="btn bg" onClick={()=>setShowPantry(false)}>← Skip / No Deductions</button>
      </div>
    );
  }

  // ── Shopping list ──
  if (showList && allDone) {
    const rawShop = calcRawWeights(data.users, data.round?.days||5);
    const hasDeductions = Object.values(pantryAmounts).some(v=>v>0);
    return (
      <div className="page" id="section-shopping">
        <div className="pt">SHOPPING <span>LIST</span></div>
        <div className="ps">Raw amounts for {data.round?.days} days · {data.users.length} user{data.users.length>1?"s":""}. All combined.</div>
        <ExportBar sectionId="section-shopping" label="Shopping List" data={data} />

        {hasDeductions && (
          <div className="al ag">
            <span className="ai">✅</span>
            <span>Pantry deductions applied — amounts shown are <strong>what you still need to buy</strong>.</span>
          </div>
        )}

        <div className="card">
          <div className="ct">🛒 Ingredients to Buy</div>
          {Object.entries(rawShop).map(([name,val])=>{
            const { g, isProtein } = val;
            const deduct = pantryAmounts[name] || 0;
            const netG   = Math.max(0, g - deduct);
            const oz     = gToOz(netG);
            const lbs    = Math.floor(gToLbs(netG));
            const remOz  = Math.round(oz % 16);
            const pkgs   = isProtein && netG > 0 ? packageGuide(netG) : null;
            const done   = netG <= 0;
            return (
              <div key={name} className="shr" style={{opacity: done ? 0.4 : 1}}>
                <div style={{flex:1}}>
                  <div className="shn" style={{display:"flex",alignItems:"center",gap:8}}>
                    {done && <span style={{color:"var(--grn)",fontSize:12}}>✓</span>}
                    {name}
                    {done && <span style={{fontSize:10,color:"var(--grn)",fontWeight:700,letterSpacing:1}}>IN STOCK</span>}
                  </div>
                  {deduct>0&&!done&&<div style={{fontSize:11,color:"var(--grn)",marginTop:2}}>−{gToOz(deduct).toFixed(1)} oz deducted (on hand)</div>}
                  {isProtein&&pkgs&&!done&&(
                    <div className="shp">
                      <span style={{color:"var(--txt2)",fontWeight:600}}>Package guide: </span>
                      {pkgs.map(p=>`${p.count}× ${p.size}oz`).join(" · ")}
                    </div>
                  )}
                  {!done&&<div className="shp">{Math.round(netG)}g raw needed</div>}
                </div>
                {!done && (
                  <div className="shw">
                    {isProtein?(
                      <>
                        <div className="shb">{lbs>0?(remOz>0?`${lbs} lb ${remOz} oz`:`${lbs} lbs`):`${oz.toFixed(1)} oz`}</div>
                        <div className="sho">{oz.toFixed(1)} oz total</div>
                      </>
                    ):(
                      <>
                        <div className="shb">{formatImperialWeight(netG)}</div>
                        <div className="sho">{oz.toFixed(1)} oz total</div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hasDeductions && (
          <div className="card">
            <div className="ct">📦 On-Hand Inventory Used</div>
            {Object.entries(pantryAmounts).filter(([,v])=>v>0).map(([name,g])=>(
              <div key={name} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bdr)",fontSize:13}}>
                <span style={{color:"var(--txt2)"}}>{name}</span>
                <span style={{color:"var(--grn)",fontWeight:700}}>−{gToOz(g).toFixed(1)} oz</span>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="ct">Per-User Meal Summary</div>
          {data.users.map(u=>{
            const m  = calcMacros(u.meal, u);
            const p  = PROTEINS.find(x=>x.id===u.meal?.protein);
            const c  = CARBS.find(x=>x.id===u.meal?.carb);
            const v  = u.meal?.veggie ? VEGGIES.find(x=>x.id===u.meal.veggie) : null;
            const lt = u.otherMeals
              ? {cals:u.otherMeals.cals||0, protein:u.otherMeals.protein||0, carbs:u.otherMeals.carbs||0, fat:u.otherMeals.fat||0}
              : null;
            return (
              <div key={u.id} style={{padding:"10px 0",borderBottom:"1px solid var(--bdr)"}}>
                <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{u.name}</div>
                <div style={{fontSize:12,color:"var(--muted)",marginTop:2}}>{p?.name} · {c?.name}{v?` · ${v.name}`:" · No veggie"}</div>
                {m&&<div style={{fontSize:11,color:"var(--acc)",marginTop:3}}>Lunch: {m.cals} kcal · P:{m.protein}g C:{m.carbs}g F:{m.fat}g</div>}
                {lt&&<div style={{fontSize:11,color:"var(--grn)",marginTop:2}}>Lunch target was: P:{lt.protein}g C:{lt.carbs}g F:{lt.fat}g</div>}
              </div>
            );
          })}
        </div>
        <button className="btn bp" onClick={onComplete}>Continue to Cooking →</button>
        <button className="btn bg" onClick={()=>{ setShowList(false); setShowPantry(false); setActiveUser(0); setBStep(0); setDoingOtherMeals(true); }}>← Edit Meals</button>
        {onBack && <button className="btn bg" style={{marginTop:6}} onClick={onBack}>← Back to Setup</button>}
      </div>
    );
  }

  // ── Meal builder ── guard against missing user
  if (!user) {
    return (
      <div className="page">
        <div className="al ar"><span className="ai">⚠️</span><span>No users found. Go back to Setup and add at least one user profile.</span></div>
        <button className="btn bg" onClick={()=>{ setActiveUser(0); setBStep(0); scrollToTop();setDoingOtherMeals(false); }}>← Refresh</button>
      </div>
    );
  }

  const banners = [
    `Review ${user?.name}'s lunch targets (after other meals), then pick protein.`,
    "Choose a protein source.",
    "Choose a carb source.",
    "Optionally add a veggie.",
  ];

  // Suggested portion scaling: how much protein does the lunch target need?
  const mealMacros = meal.protein && meal.carb ? calcMacros(meal, user) : null;
  const proteinItem = meal.protein ? PROTEINS.find(x=>x.id===meal.protein) : null;
  const suggestedServings = (lunchTargets.protein > 0 && proteinItem)
    ? Math.max(1, Math.round((lunchTargets.protein / proteinItem.protein) * 10) / 10)
    : null;

  return (
    <div className="page">
      <div className="pt">MEAL <span>BUILDER</span></div>
      <div className="ps">Building for <strong style={{color:"var(--acc)"}}>{user?.name}</strong> — {activeUser+1} of {data.users.length}</div>
      <Steps cur={bStep} total={4}/>

      {/* User tabs */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {data.users.map((u,i)=>{
          const done = u.meal?.protein && u.meal?.carb;
          return (
            <div key={u.id}
              style={{padding:"6px 12px",borderRadius:100,fontSize:12,fontWeight:700,cursor:"pointer",
                border:i===activeUser?"1px solid var(--acc)":"1px solid var(--bdr2)",
                background:i===activeUser?"rgba(255,77,0,.12)":"var(--surf3)",
                color:done?"var(--grn)":i===activeUser?"#fff":"var(--muted)"}}
              onClick={()=>switchUser(i)}>
              {done?"✓ ":""}{u.name}
            </div>
          );
        })}
      </div>

      <div className="banner"><span>⚡</span><span>{banners[bStep]}</span></div>

      {/* Step 0: Macro targets + other-meals summary */}
      {bStep===0&&(
        <>
          {/* Lunch targets card */}
          <div className="card" style={{border:"1.5px solid var(--grn)"}}>
            <div className="ct" style={{color:"var(--grn)"}}>🎯 Lunch Macro Target — {user?.name}</div>
            <MR cals={lunchTargets.cals} protein={lunchTargets.protein} carbs={lunchTargets.carbs} fat={lunchTargets.fat}/>
            {user?.otherMeals ? (
              <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>
                After accounting for {user.otherMeals.meals?.join(" + ")||"other meals"} · Daily goal: {user.cals} kcal
              </div>
            ) : (
              <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>Full daily target (no other meals logged)</div>
            )}
          </div>

          {/* Other meals breakdown with full macro summary and math */}
          {user?.otherMeals?.items?.length > 0 && (()=>{
            const items = user.otherMeals.items;
            // Check if item-level macros exist (new saves) or fall back to dailyTotal (old saves)
            const hasItemMacros = items.some(i => i.cals != null);

            // If new format: sum from items. If old format: use the stored dailyTotal.
            const omTotals = hasItemMacros
              ? items.reduce((acc, item) => ({
                  cals:    Math.round(acc.cals    + ((item.cals    || 0) * (item.count||1))),
                  protein: Math.round(acc.protein + ((item.protein || 0) * (item.count||1))),
                  carbs:   Math.round(acc.carbs   + ((item.carbs   || 0) * (item.count||1))),
                  fat:     Math.round(acc.fat     + ((item.fat     || 0) * (item.count||1))),
                }), {cals:0,protein:0,carbs:0,fat:0})
              : {
                  cals:    Math.round(user.otherMeals.dailyTotal?.cals    || 0),
                  protein: Math.round(user.otherMeals.dailyTotal?.protein || 0),
                  carbs:   Math.round(user.otherMeals.dailyTotal?.carbs   || 0),
                  fat:     Math.round(user.otherMeals.dailyTotal?.fat     || 0),
                };

            const daily = {
              cals:    Math.round(+user.cals    || 0),
              protein: Math.round(+user.protein || 0),
              carbs:   Math.round(+user.carbs   || 0),
              fat:     Math.round(+user.fat     || 0),
            };
            return (
              <div className="card">
                <div className="ct">Other Meals Accounted For</div>
                {/* Item list */}
                {items.map((item,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"7px 0",borderBottom:"1px solid var(--bdr)",fontSize:12}}>
                    <div style={{color:"var(--txt2)"}}>{item.count > 1 ? `${item.count}× ` : ""}{item.name} <span style={{color:"var(--muted)"}}>({item.meal})</span></div>
                    {item.cals != null
                      ? <div style={{color:"var(--txt2)",flexShrink:0,marginLeft:8,textAlign:"right"}}>
                          <div>{Math.round((item.cals||0)*(item.count||1))} kcal</div>
                          <div style={{color:"var(--muted)"}}>P:{Math.round((item.protein||0)*(item.count||1))}g · C:{Math.round((item.carbs||0)*(item.count||1))}g · F:{Math.round((item.fat||0)*(item.count||1))}g</div>
                        </div>
                      : <div style={{color:"var(--muted)",flexShrink:0,marginLeft:8}}>tap Update to refresh</div>
                    }
                  </div>
                ))}
                {/* Other meals subtotal */}
                <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"2px solid var(--bdr2)",fontSize:12,fontWeight:700,marginTop:2}}>
                  <span style={{color:"var(--txt2)"}}>Other meals total</span>
                  <span style={{color:"var(--acc)"}}>{omTotals.cals} kcal · P:{omTotals.protein}g · C:{omTotals.carbs}g · F:{omTotals.fat}g</span>
                </div>
                {/* Math: daily − other meals = lunch target */}
                {daily.cals > 0 && (
                  <div style={{marginTop:12,fontSize:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"var(--txt2)"}}>
                      <span>Daily goal</span>
                      <span>{daily.cals} kcal · P:{daily.protein}g · C:{daily.carbs}g · F:{daily.fat}g</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"var(--muted)"}}>
                      <span>− Other meals</span>
                      <span>{omTotals.cals} kcal · P:{omTotals.protein}g · C:{omTotals.carbs}g · F:{omTotals.fat}g</span>
                    </div>
                    <div style={{height:1,background:"var(--bdr2)",margin:"6px 0"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontWeight:700}}>
                      <span style={{color:"var(--grn)"}}>= Lunch target</span>
                      <span style={{color:"var(--grn)"}}>
                        {Math.max(0,daily.cals-omTotals.cals)} kcal · P:{Math.max(0,daily.protein-omTotals.protein)}g · C:{Math.max(0,daily.carbs-omTotals.carbs)}g · F:{Math.max(0,daily.fat-omTotals.fat)}g
                      </span>
                    </div>
                  </div>
                )}
                <button className="btn bg bsm" style={{marginTop:14}} onClick={()=>setDoingOtherMeals(true)}>Update Other Meals</button>
              </div>
            );
          })()}

          <button className="btn bp" onClick={()=>{scrollToTop();setBStep(1)}}>Pick Protein →</button>
        </>
      )}

      {/* Step 1: Protein */}
      {bStep===1&&(
        <>
          <div className="al ay" style={{marginBottom:12}}>
            <span className="ai">ℹ️</span>
            <span>Macros shown per 4oz raw serving. The app will use <strong>enough of your chosen protein to hit your macro target</strong> — not just one serving.</span>
          </div>
          {PROTEINS.map(p=>{
            const oz4Protein = Math.round((p.proteinPer100gCooked / 100) * (p.cookedPerServing * (4 / gToOz(p.rawPerServing))));
            return (
              <div key={p.id} className={`oc ${meal.protein===p.id?"sel":""}`} onClick={()=>setMeal("protein",p.id)}>
                <div className="or"/>
                <div className="ob">
                  <div className="on2">{p.name}</div>
                  <div className="om" style={{marginBottom:4}}>{p.cals} kcal · P:{p.protein}g · C:{p.carbs}g · F:{p.fat}g <span style={{color:"var(--muted)"}}>per 4oz raw</span></div>
                  <div style={{fontSize:11,color:"var(--acc)",fontWeight:600}}>≈{oz4Protein}g protein per 4oz cooked</div>
                </div>
              </div>
            );
          })}

          {/* Macro target hint */}
          {meal.protein && lunchTargets.protein > 0 && (()=>{
            const pItem = PROTEINS.find(x=>x.id===meal.protein);
            const cookedNeeded = calcCookedProteinNeeded(user, meal.protein);
            const rawNeeded    = cookedToRaw(cookedNeeded, meal.protein);
            return (
              <div className="al ag" style={{marginTop:4}}>
                <span className="ai">🎯</span>
                <div style={{fontSize:13}}>
                  To hit <strong style={{color:"#fff"}}>{lunchTargets.protein}g protein</strong> at lunch:<br/>
                  Cook <strong style={{color:"#fff"}}>{rawNeeded}g raw ({gToOz(rawNeeded).toFixed(1)} oz)</strong> → weigh out <strong style={{color:"#fff"}}>{cookedNeeded}g cooked ({gToOz(cookedNeeded).toFixed(1)} oz)</strong> per container.
                </div>
              </div>
            );
          })()}

          {meal.protein&&meal.carb&&<MR {...calcMacros(meal, user)}/>}
          <button className="btn bp" disabled={!meal.protein} onClick={()=>{scrollToTop();setBStep(2)}}>Next — Pick Carb →</button>
        </>
      )}

      {/* Step 2: Carb */}
      {bStep===2&&(
        <>
          {CARBS.map(c=>(
            <div key={c.id} className={`oc ${meal.carb===c.id?"sel":""}`} onClick={()=>setMeal("carb",c.id)}>
              <div className="or"/>
              <div className="ob">
                <div className="on2">{c.name}</div>
                <div className="om">{c.cals} kcal · C:{c.carbs}g · {gToOz(c.rawPerServing).toFixed(1)}oz raw/serving</div>
              </div>
            </div>
          ))}
          {meal.protein&&meal.carb&&(
            <>
              <MR {...calcMacros(meal, user)}/>

            </>
          )}
          <button className="btn bp" disabled={!meal.carb} onClick={()=>{scrollToTop();setBStep(3)}}>Next — Add Veggie →</button>
        </>
      )}

      {/* Step 3: Veggie */}
      {bStep===3&&(
        <>
          <div className={`oc ${!meal.veggie&&meal._noVeg?"sel":""}`} onClick={()=>{setMeal("veggie",null);setMeal("_noVeg",true);}}>
            <div className="or"/><div className="ob"><div className="on2">No Veggie</div><div className="om">Skip for this user</div></div>
          </div>
          {VEGGIES.map(v=>(
            <div key={v.id} className={`oc ${meal.veggie===v.id?"sel":""}`} onClick={()=>setMeal("veggie",v.id)}>
              <div className="or"/>
              <div className="ob">
                <div className="on2">{v.name}</div>
                <div className="om">{v.cals} kcal · {gToOz(v.rawPerServing).toFixed(1)}oz raw/serving</div>
              </div>
            </div>
          ))}

          {/* Optimized Meal Summary — auto-calculated, no manual adjustments needed */}
          {meal.protein&&meal.carb&&(()=>{
            const opt = calcOptimalMeal(meal, user, lunchTargets);
            if (!opt) return null;
            const m   = opt.macros;
            const tgt = { cals: Math.round(+lunchTargets.cals||0), protein: Math.round(+lunchTargets.protein||0) };
            const p   = PROTEINS.find(x=>x.id===meal.protein);
            const c   = CARBS.find(x=>x.id===meal.carb);
            const v   = meal.veggie ? VEGGIES.find(x=>x.id===meal.veggie) : null;
            const proteinOk = Math.abs(m.protein - tgt.protein) <= 5;
            const calsOk    = Math.abs(m.cals - tgt.cals) <= 30;

            return (
              <div style={{marginTop:12}}>
                <div style={{fontFamily:"var(--fd)",fontSize:20,letterSpacing:1,color:"var(--txt2)",marginBottom:10}}>
                  MEAL PLAN — {user?.name}
                </div>

                {/* Final macro summary */}
                <div className="mr" style={{marginBottom:14}}>
                  <div className="mc hl"><div className="v">{m.cals}</div><div className="l">Kcal</div></div>
                  <div className="mc"><div className="v">{m.protein}g</div><div className="l">Protein</div></div>
                  <div className="mc"><div className="v">{m.carbs}g</div><div className="l">Carbs</div></div>
                  <div className="mc"><div className="v">{m.fat}g</div><div className="l">Fat</div></div>
                </div>

                {/* Protein — always first, locked to target */}
                <div style={{background:"rgba(0,230,118,.08)",border:"1.5px solid rgba(0,230,118,.4)",
                  borderRadius:8,padding:"10px 14px",marginBottom:8,fontSize:13,color:"var(--grn)",fontWeight:600}}>
                  ✅ PROTEIN LOCKED — {m.protein}g
                  {p&&<span style={{fontWeight:400,color:"var(--muted)",marginLeft:6}}>
                    {opt.proteinCookedG}g cooked ({gToOz(opt.proteinCookedG).toFixed(1)} oz) of {p.name}
                  </span>}
                </div>

                {/* Calories — met by scaling carb */}
                <div style={{background: calsOk?"rgba(0,230,118,.08)":"rgba(255,140,0,.08)",
                  border:`1.5px solid ${calsOk?"rgba(0,230,118,.4)":"rgba(255,140,0,.4)"}`,
                  borderRadius:8,padding:"10px 14px",marginBottom:8,fontSize:13,
                  color:calsOk?"var(--grn)":"var(--acc2)",fontWeight:600}}>
                  {calsOk?"✅":"🟡"} CALORIES — {m.cals} kcal {tgt.cals>0&&`(target: ${tgt.cals})`}
                  {c&&<span style={{fontWeight:400,color:"var(--muted)",marginLeft:6}}>
                    {opt.carbCookedG}g cooked ({gToOz(opt.carbCookedG).toFixed(1)} oz) of {c.name} added to balance
                  </span>}
                </div>

                {/* Carbs & Fat — reported as result, not flagged */}
                <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",
                  borderRadius:8,padding:"10px 14px",marginBottom:8,fontSize:13,color:"var(--txt2)"}}>
                  <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                    <span>🍚 <strong>{m.carbs}g carbs</strong> — result of {c?.name} portion</span>
                    <span>🥑 <strong>{m.fat}g fat</strong> — result of {p?.name} fat content</span>
                    {v&&<span>🥦 <strong>{v.name}</strong> — {opt.veggieCookedG}g cooked ({gToOz(opt.veggieCookedG).toFixed(1)} oz)</span>}
                  </div>
                </div>

                {/* How it was built */}
                <div style={{fontSize:11,color:"var(--muted)",marginBottom:14,lineHeight:1.7,padding:"8px 0"}}>
                  Protein was set first to hit {tgt.protein}g. {c?.name} portion was scaled to fill remaining {Math.max(0,tgt.cals-(opt.proteinMacros.cals+(v?opt.veggieMacros.cals:0)))} kcal.
                  Carbs and fat are the natural result of those portions.
                </div>
              </div>
            );
          })()}

          <button className="btn bp" disabled={!(meal.protein&&meal.carb)} onClick={nextUser}>
            {activeUser<data.users.length-1
              ? `✓ Done — Next: ${data.users[activeUser+1]?.name} →`
              : "✓ All Done — View Shopping List →"}
          </button>
        </>
      )}
    </div>
  );
}

// ─── MODULE 3 ─────────────────────────────────────────────────────────────────

function CookingOptions({ data, setData, onComplete, onBack }) {
  const [step, setStep]   = useState(0);
  const [equip, setEquip] = useState(data.equipment||[]);
  const [meths, setMeths] = useState(data.methodChoices||{});

  const hasRestr  = data.users.some(u => u.restrictions && !u.restrictions.includes("None"));
  const restrUsrs = data.users.filter(u => u.restrictions && !u.restrictions.includes("None"));

  const ingr = [];
  const seen = new Set();
  data.users.forEach(u => {
    [u.meal?.protein, u.meal?.carb, u.meal?.veggie].filter(Boolean).forEach(id => {
      if (!seen.has(id)) { seen.add(id); ingr.push(id); }
    });
  });

  function toggleE(e) { setEquip(p => p.includes(e) ? p.filter(x=>x!==e) : [...p,e]); }
  function setM(id,m) { setMeths(p => ({ ...p, [id]:m })); }
  function getName(id) { return [...PROTEINS,...CARBS,...VEGGIES].find(x=>x.id===id)?.name||id; }
  function getItem(id) { return [...PROTEINS,...CARBS,...VEGGIES].find(x=>x.id===id); }

  function getBest(id) {
    const sug = SUGGESTED_METHOD[id];
    if (equip.includes(sug)) return sug;
    return equip.find(e => COOKING_INSTRUCTIONS[id]?.[e]?.time!=="N/A") || equip[0] || sug;
  }

  function finish() { setData({ ...data, equipment:equip, methodChoices:meths }); onComplete(); }

  if (step===0) return (
    <div className="page">
      <div className="pt">KITCHEN <span>SETUP</span></div>
      <div className="ps">Select available equipment. We'll suggest the best method for each ingredient.</div>
      <div className="banner"><span>⚡</span><span>Select your equipment below to unlock cooking suggestions.</span></div>
      <div className="al ao">
        <span className="ai">📦</span>
        <span><strong>Prep your containers now.</strong> You need {data.users.reduce((s,u)=>s+Math.round(+(u.days||data.round?.days||5))*Math.round(+(u.mealsPerDay||data.round?.mealsPerDay||1)),0)} Tupperware containers — one per person per meal. Lay them out before cooking.</span>
      </div>
      <div className="card">
        <div className="ct">Available Equipment — select all that apply</div>
        <div className="pg">
          {COOKING_METHODS.map(m=>(
            <div key={m} className={`pill ${equip.includes(m)?"on":""}`} onClick={()=>toggleE(m)}>{m}</div>
          ))}
        </div>
      </div>
      <button className="btn bp" disabled={equip.length===0} onClick={()=>{scrollToTop();setStep(1)}}>Next — Dietary Check →</button>
      {onBack && <button className="btn bg" style={{marginTop:6}} onClick={onBack}>← Back to Shopping</button>}
    </div>
  );

  if (step===1) return (
    <div className="page">
      <div className="pt">DIETARY <span>CHECK</span></div>
      <div className="ps">Review restrictions before you start cooking.</div>
      {hasRestr?(
        <>
          <div className="al ar">
            <span className="ai">🚨</span>
            <div>
              <strong>SEPARATE HANDLING REQUIRED</strong>
              {restrUsrs.map(u=>(
                <div key={u.id} style={{marginTop:6}}><strong>{u.name}:</strong> {u.restrictions.join(", ")}</div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="ct">⚠️ Required Actions</div>
            {["Cook restricted portions in separate pans/batches.",
              "Use dedicated utensils — no cross-contamination.",
              "Label restricted containers immediately after portioning.",
              "Clean all surfaces before cooking unrestricted portions."].map((t,i)=>(
              <div key={i} style={{fontSize:13,color:"var(--txt2)",padding:"8px 0",borderBottom:i<3?"1px solid var(--bdr)":"none"}}>· {t}</div>
            ))}
          </div>
        </>
      ):(
        <div className="al ag">
          <span className="ai">✅</span>
          <div><strong>All Clear — Cook Everything Together</strong><br/>No restrictions detected. Batch all ingredients together.</div>
        </div>
      )}
      <button className="btn bp" onClick={()=>{scrollToTop();setStep(2)}}>Next — Cooking Instructions →</button>
      <button className="btn bg" onClick={()=>{scrollToTop();setStep(0)}}>← Back</button>
    </div>
  );

  if (step===2) return (
    <div className="page" id="section-cooking">
      <div className="pt">COOKING <span>GUIDE</span></div>
      <div className="ps">Select your method per ingredient. ★ = recommended for that ingredient.</div>
      <ExportBar sectionId="section-cooking" label="Cooking Instructions" data={data} />
      {ingr.map(id=>{
        const avail   = equip.filter(e => COOKING_INSTRUCTIONS[id]?.[e]);
        const sug     = SUGGESTED_METHOD[id];
        const chosen  = meths[id]||getBest(id);
        const instr   = COOKING_INSTRUCTIONS[id]?.[chosen];
        const isNA    = instr?.time==="N/A";
        return (
          <div key={id} className="card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{getName(id)}</div>
              {chosen===sug&&<span style={{fontSize:10,fontWeight:700,color:"var(--acc)",border:"1px solid var(--acc)",borderRadius:100,padding:"2px 8px",letterSpacing:1}}>★ BEST</span>}
            </div>
            <div className="pg" style={{marginBottom:4}}>
              {avail.map(m=>(
                <div key={m} className={`pill ${chosen===m?"on":""}`} onClick={()=>setM(id,m)}>{m}{m===sug?" ★":""}</div>
              ))}
            </div>
            {instr&&!isNA&&(
              <div className="inb">
                <div className="inc">
                  <span className="ich">🌡 {instr.temp}</span>
                  <span className="ich">⏱ {instr.time}</span>
                </div>
                <div className="int">💡 {instr.tips}</div>
              </div>
            )}
            {instr&&isNA&&(
              <div className="al ay" style={{marginTop:8,marginBottom:0}}>
                <span className="ai">ℹ️</span><span>{instr.tips}</span>
              </div>
            )}
          </div>
        );
      })}
      <button className="btn bp" onClick={()=>{scrollToTop();setStep(3)}}>Next — Portioning Guide →</button>
      <button className="btn bg" onClick={()=>{scrollToTop();setStep(1)}}>← Back</button>
    </div>
  );

  if (step===3) {
    // days/mealsPerDay are per-user; compute per-ingredient totals inline using user's own values
    const eatBy = new Date(); eatBy.setDate(eatBy.getDate() + 4); // conservative shelf life

    return (
    <div className="page" id="section-portioning">
      <div className="pt">PORTIONING <span>GUIDE</span></div>
      <div className="ps">Full group totals, per-container weights, and container list for all {data.users.length} user{data.users.length>1?"s":""}.</div>
      <ExportBar sectionId="section-portioning" label="Portioning Guide" data={data} />
      <div className="al ao">
        <span className="ai">⚖️</span>
        <span><strong>Use a kitchen scale.</strong> Weigh your total cooked batch, then use the per-container weights below to divide into each Tupperware.</span>
      </div>

      {ingr.map(id=>{
        const item      = getItem(id);
        const isProtein = PROTEINS.some(x => x.id === id);

        // Build per-user cooked portion amounts
        const usersForIngr = data.users.filter(u =>
          u.meal?.protein===id || u.meal?.carb===id || u.meal?.veggie===id
        );

        // Per user: cooked grams per single meal container
        const userPortions = usersForIngr.map(u => {
          const lt = u.otherMeals
            ? { cals:+u.otherMeals.cals||0, protein:+u.otherMeals.protein||0, carbs:+u.otherMeals.carbs||0, fat:+u.otherMeals.fat||0 }
            : { cals:+u.cals||0, protein:+u.protein||0, carbs:+u.carbs||0, fat:+u.fat||0 };
          const opt = calcOptimalMeal(u.meal, u, lt);
          let cookedPerMeal;
          if (isProtein)                    cookedPerMeal = opt ? opt.proteinCookedG : calcCookedProteinNeeded(u, id);
          else if (CARBS.some(x=>x.id===id)) cookedPerMeal = opt ? opt.carbCookedG    : item.cookedPerServing;
          else                               cookedPerMeal = item.cookedPerServing; // veggie unchanged
          const scaledProtein = isProtein ? Math.round((item.proteinPer100gCooked / 100) * cookedPerMeal) : null;
          return { user: u, cookedPerMeal, scaledProtein };
        });

        // Total cooked for ALL meals (users × days × mealsPerDay)
        const totalCookedG = userPortions.reduce((s, x) => {
          const ud = Math.round(+(x.user.days||5)); const um = Math.round(+(x.user.mealsPerDay||1));
          return s + x.cookedPerMeal * ud * um;
        }, 0);
        const totalCookedOz = gToOz(totalCookedG);
        const totalRawG = userPortions.reduce((s, x) => {
          const ud = Math.round(+(x.user.days||5)); const um = Math.round(+(x.user.mealsPerDay||1));
          const lt = x.user.otherMeals
            ? { cals:+x.user.otherMeals.cals||0, protein:+x.user.otherMeals.protein||0, carbs:+x.user.otherMeals.carbs||0, fat:+x.user.otherMeals.fat||0 }
            : { cals:+x.user.cals||0, protein:+x.user.protein||0, carbs:+x.user.carbs||0, fat:+x.user.fat||0 };
          const opt = calcOptimalMeal(x.user.meal, x.user, lt);
          let rawPerMeal;
          if (isProtein)                     rawPerMeal = opt ? opt.proteinRawG : cookedToRaw(x.cookedPerMeal, id);
          else if (CARBS.some(z=>z.id===id)) rawPerMeal = opt ? opt.carbRawG    : item.rawPerServing;
          else                               rawPerMeal = item.rawPerServing;
          return s + rawPerMeal * ud * um;
        }, 0);
        const totalRawOz = gToOz(totalRawG);
        const totalContainers = userPortions.reduce((s,x)=>s+Math.round(+(x.user.days||5))*Math.round(+(x.user.mealsPerDay||1)),0);

        return (
          <div key={id} className="card">
            <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:12}}>{item.name}</div>

            {/* Full group summary */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              <div style={{background:"var(--surf3)",border:"1px solid var(--bdr2)",borderRadius:8,padding:"12px",textAlign:"center"}}>
                <div style={{fontSize:10,color:"var(--muted)",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Total Raw — Buy</div>
                <div style={{fontFamily:"var(--fd)",fontSize:24,color:"var(--acc)",lineHeight:1}}>{totalRawOz.toFixed(1)} oz</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{Math.round(totalRawG)}g</div>
              </div>
              <div style={{background:"var(--surf3)",border:"1px solid var(--bdr2)",borderRadius:8,padding:"12px",textAlign:"center"}}>
                <div style={{fontSize:10,color:"var(--muted)",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Total Cooked — Weigh</div>
                <div style={{fontFamily:"var(--fd)",fontSize:24,color:"var(--acc2)",lineHeight:1}}>{totalCookedOz.toFixed(1)} oz</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{Math.round(totalCookedG)}g · {totalContainers} containers</div>
              </div>
            </div>

            {/* Per-container breakdown — one row per user per meal */}
            <div style={{fontSize:11,color:"var(--muted)",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>
              {totalContainers} Containers total — each user uses their own day count
            </div>
            <table className="pt2">
              <thead>
                <tr>
                  <th>Container</th>
                  <th>User</th>
                  <th>Ounces</th>
                  <th>Grams</th>
                  {isProtein && <th>Protein</th>}
                </tr>
              </thead>
              <tbody>
                {usersForIngr.flatMap((u, ui) => {
                  const ud = Math.round(+(u.days||5)); const um = Math.round(+(u.mealsPerDay||1));
                  return Array.from({ length: ud * um }).map((_, containerIdx) => {
                    const portion = userPortions.find(x => x.user.id === u.id);
                    const cookedG = portion?.cookedPerMeal || 0;
                    const oz = gToOz(cookedG);
                    const dayNum = Math.floor(containerIdx / um) + 1;
                    const mealNum = um > 1 ? (containerIdx % um) + 1 : null;
                    return (
                      <tr key={`${u.id}-${containerIdx}`} style={{opacity: containerIdx===0?1:0.7}}>
                        <td style={{color:"var(--muted)",fontSize:11}}>
                          Day {dayNum}{mealNum ? `, M${mealNum}` : ""}
                        </td>
                        <td style={{color:"#fff",fontWeight:600}}>{u.name}</td>
                        <td><span className="pv2">{oz.toFixed(1)}</span><span className="pu">oz</span></td>
                        <td><span className="pv">{cookedG}g</span></td>
                        {isProtein && <td><span style={{color:"var(--grn)",fontFamily:"var(--fd)",fontSize:16}}>{portion?.scaledProtein}g</span><span className="pu">P</span></td>}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Container Summary — one label-style card per user */}
      <div style={{fontFamily:"var(--fd)",fontSize:22,letterSpacing:2,color:"var(--acc)",margin:"20px 0 10px"}}>
        TYPICAL CONTAINER — <span style={{color:"#fff"}}>PER USER</span>
      </div>
      <div style={{fontSize:12,color:"var(--muted)",marginBottom:14}}>
        Each user gets the same meal every day. Here's what goes in each of their containers.
      </div>
      {data.users.map(u=>{
        const p = PROTEINS.find(x=>x.id===u.meal?.protein);
        const c = CARBS.find(x=>x.id===u.meal?.carb);
        const v = u.meal?.veggie ? VEGGIES.find(x=>x.id===u.meal.veggie) : null;
        const lt2 = u.otherMeals
          ? { cals:+u.otherMeals.cals||0, protein:+u.otherMeals.protein||0, carbs:+u.otherMeals.carbs||0, fat:+u.otherMeals.fat||0 }
          : { cals:+u.cals||0, protein:+u.protein||0, carbs:+u.carbs||0, fat:+u.fat||0 };
        const opt2 = (p && c) ? calcOptimalMeal(u.meal, u, lt2) : null;
        const pCooked  = opt2 ? opt2.proteinCookedG : (p ? calcCookedProteinNeeded(u, u.meal.protein) : 0);
        const cCooked  = opt2 ? opt2.carbCookedG    : (c?.cookedPerServing||0);
        const pProtein = p ? Math.round((p.proteinPer100gCooked/100)*pCooked) : 0;
        const tG  = pCooked + cCooked + (v?.cookedPerServing||0);
        const tOz = gToOz(tG);
        const m   = opt2 ? opt2.macros : calcMacros(u.meal, u);
        const eatByStr = eatBy.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        return (
          <div key={u.id} className="lp" style={{marginBottom:14}}>
            {/* Label header — matches container label style */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div className="lpn">{u.name?.toUpperCase()}</div>
              <div style={{textAlign:"right",fontSize:11,color:"#666"}}>
                <div>📅 Eat by <b style={{color:"#111"}}>{eatByStr}</b></div>
                <div style={{marginTop:2}}>{tG}g / {tOz.toFixed(1)} oz total</div>
              </div>
            </div>
            {/* Macro row */}
            <div className="lpr" style={{marginBottom:10}}>
              {m&&<>
                <div className="lpi">🔥 <b>{m.cals} kcal</b></div>
                <div className="lpi">P <b>{m.protein}g</b></div>
                <div className="lpi">C <b>{m.carbs}g</b></div>
                <div className="lpi">F <b>{m.fat}g</b></div>
              </>}
            </div>
            {/* Ingredients */}
            <div style={{borderTop:"1px dashed #ccc",paddingTop:8,display:"flex",flexDirection:"column",gap:4}}>
              {p&&<div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#333"}}>
                <span>{p.name}</span>
                <span style={{fontWeight:700,color:"#111"}}>{pCooked}g ({gToOz(pCooked).toFixed(1)} oz) cooked — {pProtein}g P</span>
              </div>}
              {c&&<div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#333"}}>
                <span>{c.name}</span>
                <span style={{fontWeight:700,color:"#111"}}>{cCooked}g ({gToOz(cCooked).toFixed(1)} oz) cooked</span>
              </div>}
              {v&&<div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#333"}}>
                <span>{v.name}</span>
                <span style={{fontWeight:700,color:"#111"}}>{v.cookedPerServing}g ({gToOz(v.cookedPerServing).toFixed(1)} oz) cooked</span>
              </div>}
            </div>
          </div>
        );
      })}

      <button className="btn bp" onClick={finish}>Continue to Storage →</button>
      <button className="btn bg" onClick={()=>{scrollToTop();setStep(2)}}>← Back</button>
    </div>
  );
  }
}

// ─── MODULE 4 ─────────────────────────────────────────────────────────────────

function StorageOptions({ data, onBack }) {
  const days = data.round?.days||5;
  const shelf = data.users.length>0&&data.users[0].meal?.protein
    ? Math.min(...data.users.map(u=>u.meal?.protein?calcShelfLife(u.meal):7)) : 5;
  const eatBy = new Date(); eatBy.setDate(eatBy.getDate()+shelf);

  return (
    <div className="page" id="section-storage">
      <div className="pt">STORAGE <span>& TIPS</span></div>
      <div className="ps">How to store, reheat, and enjoy your prepped meals.</div>
      <ExportBar sectionId="section-storage" label="Storage &amp; Tips" showFull={true} onFullExport={()=>triggerFullExport(data)} data={data} />
      {onBack && <button className="btn bg bsm no-print" style={{marginBottom:12}} onClick={onBack}>← Back to Cooking</button>}

      {days>shelf?(
        <div className="al ar"><span className="ai">⛔</span>
          <span><strong>Storage Warning:</strong> Cycle is {days} days but most perishable ingredient is safe for only <strong>{shelf} days</strong>. Consume those first.</span>
        </div>
      ):(
        <div className="al ag"><span className="ai">✅</span>
          <span>All meals safe for the full <strong>{days}-day cycle</strong>. Eat by <strong>{eatBy.toDateString()}</strong>.</span>
        </div>
      )}

      <div className="card">
        <div className="ct">🗓 Shelf Life by Ingredient</div>
        {data.users[0]?.meal?.protein&&(()=>{
          const u=data.users[0];
          return [
            PROTEINS.find(x=>x.id===u.meal.protein),
            CARBS.find(x=>x.id===u.meal.carb),
            u.meal.veggie?VEGGIES.find(x=>x.id===u.meal.veggie):null,
          ].filter(Boolean).map(item=>(
            <div key={item.id} className="shr">
              <div className="shn">{item.name}</div>
              <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                <div style={{fontFamily:"var(--fd)",fontSize:28,color:item.shelfDays<=4?"var(--red)":"var(--grn)",lineHeight:1}}>{item.shelfDays}</div>
                <div style={{fontSize:12,color:"var(--muted)"}}>days max</div>
              </div>
            </div>
          ));
        })()}
      </div>

      <div className="card">
        <div className="ct">📦 Storage Guidelines</div>
        {STORAGE_TIPS.map((t,i)=>(
          <div key={i} style={{fontSize:13,color:"var(--txt2)",padding:"8px 0",borderBottom:i<STORAGE_TIPS.length-1?"1px solid var(--bdr)":"none",lineHeight:1.6}}>· {t}</div>
        ))}
      </div>

      <div className="card">
        <div className="ct">🔥 Reheating Guide</div>
        {Object.entries(REHEAT_TIPS).map(([m,t])=>(
          <div key={m} style={{marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--acc)",marginBottom:4}}>{m}</div>
            <div style={{fontSize:13,color:"var(--txt2)",lineHeight:1.65}}>{t}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="ct">🏷 Container Labels</div>
        <div style={{fontSize:12,color:"var(--muted)",marginBottom:14}}>Suggested label per container:</div>
        {data.users.map(u=>{
          const m=calcMacros(u.meal, u);
          return (
            <div key={u.id} className="lp">
              <div className="lpn">{u.name?.toUpperCase()}</div>
              <div className="lpr">
                <div className="lpi">📅 <b>{eatBy.toLocaleDateString()}</b></div>
                {m&&<>
                  <div className="lpi">🔥 <b>{m.cals} kcal</b></div>
                  <div className="lpi">P <b>{m.protein}g</b></div>
                  <div className="lpi">C <b>{m.carbs}g</b></div>
                  <div className="lpi">F <b>{m.fat}g</b></div>
                </>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="ct">⚡ Pro Tips</div>
        {["Move tomorrow's container to the front of the fridge each night.",
          "Add hot sauce, salsa, or mustard at eat-time — not during prep — to keep textures fresh.",
          "For rice: add a few drops of water before microwaving to restore moisture.",
          "Eat the highest-protein combos early in the week when they're freshest.",
          "Uniform glass containers stack better and preserve food quality longer.",
        ].map((t,i)=>(
          <div key={i} style={{fontSize:13,color:"var(--txt2)",padding:"8px 0",borderBottom:i<4?"1px solid var(--bdr)":"none",lineHeight:1.6}}>{i+1}. {t}</div>
        ))}
      </div>

    </div>
  );
}

// ─── FULL EXPORT ─────────────────────────────────────────────────────────────


// ─── AUTH SCREEN ─────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [mode, setMode]       = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [message, setMessage] = useState('');

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) { setError('Please enter your email and password.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError(''); setMessage('');
    try {
      const sb = await getSupa();
      if (mode === 'signup') {
        const { data, error: e } = await sb.auth.signUp({ email: email.trim(), password });
        if (e) { setError(e.message); return; }
        if (data.user && !data.session) {
          setMessage('Check your email for a confirmation link, then sign in.');
        } else if (data.session) {
          onAuth(data.session.user);
        }
      } else {
        const { data, error: e } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (e) { setError(e.message); return; }
        onAuth(data.user);
      }
    } catch(e) {
      setError('Connection error. Check your internet and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/kisss-logo.png" alt="KISSS MEALS" />
        </div>
        <div className="auth-title">KISSS MEALS</div>
        <div className="auth-sub">Meal Prep Planner for Simple Shred</div>

        <div className="auth-tabs">
          <div className={`auth-tab ${mode==='signin'?'active':''}`} onClick={()=>{setMode('signin');setError('');setMessage('')}}>Sign In</div>
          <div className={`auth-tab ${mode==='signup'?'active':''}`} onClick={()=>{setMode('signup');setError('');setMessage('')}}>Create Account</div>
        </div>

        {error   && <div className="auth-err">⚠️ {error}</div>}
        {message && <div className="auth-ok">✅ {message}</div>}

        <label className="lbl">Email</label>
        <input className="inp" type="email" inputMode="email" autoComplete="email"
          placeholder="your@email.com" value={email}
          onChange={e=>setEmail(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&handleSubmit()} />

        <label className="lbl">Password</label>
        <input className="inp" type="password" autoComplete={mode==='signup'?'new-password':'current-password'}
          placeholder={mode==='signup'?'Min 6 characters':'Your password'} value={password}
          onChange={e=>setPassword(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&handleSubmit()} />

        <button className="btn bp" disabled={loading} onClick={handleSubmit} style={{marginTop:12}}>
          {loading ? '⏳ Please wait...' : mode==='signup' ? 'Create Account' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab]         = useState(0);
  const [data, setData]       = useState({ users:[], round:null, equipment:[], methodChoices:{}, history:[] });
  const [authUser, setAuthUser] = useState(null);   // null = not logged in
  const [authLoading, setAuthLoading] = useState(true); // checking session on mount
  const [saving, setSaving]   = useState(false);    // shows saving indicator

  // ── Check for existing session on app load ──────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const sb = await getSupa();
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user) {
          await loadUserData(session.user);
        }
      } catch(e) { console.error('session check:', e); }
      finally { setAuthLoading(false); }

      // Listen for auth state changes (sign in / sign out)
      const sb = await getSupa();
      const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await loadUserData(session.user);
        } else if (event === 'SIGNED_OUT') {
          setAuthUser(null);
          setData({ users:[], round:null, equipment:[], methodChoices:{}, history:[] });
          setTab(0);
        }
      });
      return () => subscription.unsubscribe();
    })();
  }, []);

  // ── Load profiles + cycle history from Supabase ─────────────────────────
  async function loadUserData(user) {
    try {
      const [profiles, cycles] = await Promise.all([
        dbLoadProfiles(user.id),
        dbLoadCycles(user.id),
      ]);
      setAuthUser(user);
      setData(prev => ({
        ...prev,
        users: profiles,
        history: cycles.map(c => ({ days:c.days, mealsPerDay:c.mealsPerDay, date:c.date })),
        _cycles: cycles,
      }));
    } catch(e) { console.error('loadUserData:', e); setAuthUser(user); }
  }

  // ── Save a profile (create or update) ───────────────────────────────────
  const saveProfileToDB = useCallback(async (user) => {
    if (!authUser) return user;
    setSaving(true);
    try {
      const dbId = await dbSaveProfile(authUser.id, user);
      return { ...user, _dbId: dbId || user._dbId };
    } catch(e) { console.error('saveProfileToDB:', e); return user; }
    finally { setSaving(false); }
  }, [authUser]);

  // ── Delete a profile ─────────────────────────────────────────────────────
  const deleteProfileFromDB = useCallback(async (user) => {
    if (!authUser || !user._dbId) return;
    try { await dbDeleteProfile(user._dbId); }
    catch(e) { console.error('deleteProfileFromDB:', e); }
  }, [authUser]);

  // ── Save completed cycle to history ─────────────────────────────────────
  async function saveCycleToDB(cycleData) {
    if (!authUser) return;
    try { await dbSaveCycle(authUser.id, cycleData); }
    catch(e) { console.error('saveCycleToDB:', e); }
  }

  // ── Sign out ─────────────────────────────────────────────────────────────
  async function signOut() {
    const sb = await getSupa();
    await sb.auth.signOut();
  }

  // ── Post-login home chooser ─────────────────────────────────────────────
  const [appScreen, setAppScreen] = useState('choose'); // 'choose' | 'active'

  // When user logs in, always show the chooser first
  // Reset to chooser on sign-out is handled via SIGNED_OUT event above

  function startNewCycle() {
    setData(prev => ({
      ...prev,
      users: prev.users.map(u => ({ ...u, meal: initMeal(), otherMeals: undefined })),
      round: null, equipment: [], methodChoices: {},
    }));
    scrollToTop();
    setTab(0);
    setAppScreen('active');
  }

  function loadPreviousCycle(cycle) {
    setData(prev => ({
      ...prev,
      users: cycle.users && cycle.users.length > 0 ? cycle.users : prev.users,
      round: { days: cycle.days, mealsPerDay: cycle.mealsPerDay },
      equipment: cycle.equipment || [],
      methodChoices: cycle.methodChoices || {},
    }));
    scrollToTop();
    setTab(0);
    setAppScreen('active');
  }

  // ── Tab state ────────────────────────────────────────────────────────────
  const setupDone    = data.users.length>0 && !!data.round;
  const shoppingDone = setupDone && data.users.every(u=>u.meal?.protein&&u.meal?.carb);
  const cookingDone  = shoppingDone && (data.equipment||[]).length>0;

  function tabState(i) {
    if (i===0) return tab===0?"active":setupDone?"done":"next";
    if (i===1) { if (!setupDone) return "locked"; if (tab===1) return "active"; return shoppingDone?"done":"next"; }
    if (i===2) { if (!shoppingDone) return "locked"; if (tab===2) return "active"; return cookingDone?"done":"next"; }
    if (i===3) { if (!cookingDone) return "locked"; if (tab===3) return "active"; return "done"; }
    return "locked";
  }

  async function completeSetup() {
    const d = new Date().toLocaleDateString();
    const h = [{days:data.round.days,mealsPerDay:data.round.mealsPerDay,date:d},...(data.history||[])].slice(0,5);
    setData(p=>({...p,history:h}));
    scrollToTop();
    setTab(1);
  }

  async function completeCooking() {
    await saveCycleToDB(data);
    scrollToTop();
    setTab(3);
  }

  // ── Loading / auth gate ──────────────────────────────────────────────────
  if (authLoading) return (
    <>
      <style>{S}</style>
      <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#000"}}>
        <div style={{textAlign:"center"}}>
          <img src="/kisss-logo.png" alt="KISSS MEALS" style={{height:80,marginBottom:16,filter:"drop-shadow(0 0 8px rgba(0,0,0,.6))"}}/>
          <div style={{fontFamily:"var(--fd)",fontSize:22,color:"var(--acc)",letterSpacing:2}}>Loading...</div>
        </div>
      </div>
    </>
  );

  if (!authUser) return (
    <>
      <style>{S}</style>
      <AuthScreen onAuth={loadUserData} />
    </>
  );

  const tabs = [{l:"Setup",i:"👤"},{l:"Shop",i:"🛒"},{l:"Cook",i:"🍳"},{l:"Store",i:"📦"}];

  // ── Home chooser screen ──────────────────────────────────────────────────
  if (appScreen === 'choose') {
    const cycles = data._cycles || [];
    return (
      <>
        <style>{S}</style>
        <div className="app">
          <div className="hdr">
            <div className="hdr-row">
              <div>
                <img src="/kisss-logo.png" alt="KISSS MEALS" className="logo-img" />
                <div className="logo-sub">Meal Prep Planner for Simple Shred</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                <button className="signout-btn" onClick={signOut}>Sign Out</button>
              </div>
            </div>
          </div>
          <div className="page" style={{paddingTop:32}}>
            <div className="pt">WELCOME <span>BACK</span></div>
            <div className="ps" style={{marginBottom:28}}>
              {authUser?.email ? `Signed in as ${authUser.email}` : "What would you like to do?"}
            </div>

            <button className="btn bp" style={{fontSize:16,padding:"18px 20px",marginBottom:12}}
              onClick={startNewCycle}>
              🆕 Start New Prep Cycle
            </button>

            <button className="btn bs"
              style={{fontSize:16,padding:"18px 20px",marginBottom:cycles.length>0?24:0,
                opacity: cycles.length>0?1:0.4, cursor:cycles.length>0?"pointer":"not-allowed"}}
              disabled={cycles.length===0}
              onClick={()=>cycles.length>0 && loadPreviousCycle(cycles[0])}>
              {cycles.length>0 ? `♻️ Repeat Last Cycle (${cycles[0].date})` : "♻️ No Previous Cycles Yet"}
            </button>

            {cycles.length > 1 && (
              <div className="card" style={{marginTop:8}}>
                <div className="ct">⏱ Older Cycles</div>
                {cycles.slice(1,5).map((c,i)=>(
                  <div key={i} className="hi" onClick={()=>loadPreviousCycle(c)}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{c.days}d · {c.mealsPerDay} meal{c.mealsPerDay>1?"s":""}/day</div>
                      <div style={{fontSize:11,color:"var(--muted)"}}>{c.date}</div>
                    </div>
                    <span style={{color:"var(--acc)",fontSize:12,fontWeight:700}}>LOAD ›</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{S}</style>
      <div className="app">
        <div className="hdr">
          <div className="hdr-row">
            <div>
              <img src="/kisss-logo.png" alt="KISSS MEALS" className="logo-img" />
              <div className="logo-sub">Meal Prep Planner for Simple Shred</div>
            </div>
            <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
              {data.round&&(
                <div className="hdr-info">
                  <div className="days">{data.round.days}D / {data.round.mealsPerDay}M</div>
                  <div className="sub">{data.users.length} user{data.users.length!==1?"s":""}</div>
                </div>
              )}
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {saving&&<span style={{fontSize:10,color:"var(--grn)"}}>💾 Saving...</span>}
                <button className="signout-btn" onClick={signOut}>Sign Out</button>
              </div>
            </div>
          </div>
        </div>

        <div className="nav">
          {tabs.map(({l,i},idx)=>{
            const st = tabState(idx);
            const locked = st==="locked";
            return (
              <div key={idx} className={`nt ${st}`} onClick={()=>{if(!locked){scrollToTop();setTab(idx)}}}>
                <div className="nt-in">
                  <span className="nt-icon">{st==="done"?"✅":i}</span>
                  <div className="nt-lbl">{l}</div>
                </div>
                {(st==="next"||st==="done")&&tab!==idx&&<div className="nt-dot"/>}
              </div>
            );
          })}
        </div>

        {tab===0&&<UserSetup      data={data} setData={setData} onComplete={completeSetup} onSaveProfile={saveProfileToDB} onDeleteProfile={deleteProfileFromDB} onBack={()=>setAppScreen("choose")}/>}
        {tab===1&&<ShoppingOptions data={data} setData={setData} onComplete={()=>setTab(2)} onBack={()=>setTab(0)}/>}
        {tab===2&&<CookingOptions  data={data} setData={setData} onComplete={completeCooking} onBack={()=>setTab(1)}/>}
        {tab===3&&<StorageOptions  data={data} onBack={()=>setTab(2)}/>}
      </div>
    </>
  );
}
