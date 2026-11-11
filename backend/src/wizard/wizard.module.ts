import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WizardController } from './wizard.controller';
import { WizardService } from './wizard.service';

@Module({
  imports: [PrismaModule],
  controllers: [WizardController],
  providers: [WizardService],
  exports: [WizardService],
})
export class WizardModule {}
