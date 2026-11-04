// Versioned seed knowledge is data; grammar algorithms live in the registry/language runtime.
import {loadCore} from '../foundation/data.mjs';
const data=loadCore('english.json');
export const {ADJECTIVES,ADVERBS,AUX,CONCEPTS,CONJUNCTIONS,CONTRACTIONS,DETERMINERS,IDIOMS,INTERJECTIONS,IRREGULAR,MODALS,NEGATORS,NOUNS,POSSESSIVE_DETERMINERS,PREPOSITIONS,PRONOUNS,RULES,SOURCE,VERBS,WH}=data;
