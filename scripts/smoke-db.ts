import { pool } from "../src/db/pool.js";
import { findService, insertService } from "../src/services/db.js";
import { CreateService } from "../src/services/schema.js";

try{
    const mockService: CreateService = {
    title: "Standard Diagnostic Assessment",
    priceCents: 9500,
};

const service = await insertService(mockService);
const serviceId = await findService(service.id);
if(!serviceId){
    console.log('not found');
    
}else{
    console.log(service)
}
}finally{
  await pool.end();
}