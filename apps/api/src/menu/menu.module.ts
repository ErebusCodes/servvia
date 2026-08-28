import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { MenuItemsController } from './menu-items.controller';
import { MenuItemsService } from './menu-items.service';
import { ChannelMenuController } from './channel-menu.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CategoriesController, MenuItemsController, ChannelMenuController],
  providers: [CategoriesService, MenuItemsService],
})
export class MenuModule {}
