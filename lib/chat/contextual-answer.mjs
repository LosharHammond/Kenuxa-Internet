import { DevelopmentalWorkspace } from '../mind/developmental-workspace.mjs';
const workspace = new DevelopmentalWorkspace();
export function contextualAnswer(question,history=[]){ return workspace.infer(question,history); }
