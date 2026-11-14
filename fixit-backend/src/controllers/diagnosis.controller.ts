import type{Request, Response,NextFunction} from 'express';
import {sendError, sendSuccess} from '../utils/apiResponse.js';

export const createDiagnosis=async(req:Request,res:Response,next:NextFunction)=>{
    try{

        //1. receive the validated request 
        //2. Call the diagnosis service 
        //3. Return standardize response

    }catch(error){
          next(error)
    }
}