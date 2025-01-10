import { SetMetadata } from '@nestjs/common';
import { ORDER_ACCESS_MODE_KEY, type OrderAccessMode } from './order-access.types';

export const OrderAccess = (mode: OrderAccessMode) => SetMetadata(ORDER_ACCESS_MODE_KEY, mode);
