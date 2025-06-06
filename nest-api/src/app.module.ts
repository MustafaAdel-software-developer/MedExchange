import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { EntitiesModule } from './entities/entities.module';
import { IdentificationsModule } from './identifications/identifications.module';
import { PaymentsModule } from './payments/payments.module';
import { OrdersModule } from './orders/orders.module';
import { ServicesModule } from './services/services.module';
import { BillableItemsModule } from './billable-items/billable-items.module';
import { LocationsModule } from './locations/locations.module';
import { EntityDocumentsModule } from './entity-documents/entity-documents.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    EntitiesModule,
    IdentificationsModule,
    PaymentsModule,
    OrdersModule,
    ServicesModule,
    BillableItemsModule,
    LocationsModule,
    EntityDocumentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
