import {Router} from "express";
import { createDiagnosis } from "../controllers/diagnosis.controller.js";

export const diagnosisRouter=Router();

diagnosisRouter.post('/',createDiagnosis)