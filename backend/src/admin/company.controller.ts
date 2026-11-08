import { Body, Controller, Get, Inject, Param, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from '../common/admin.guard';
import { CompanyService } from './company.service';

@Controller('admin/company')
@UseGuards(AdminGuard)
export class CompanyController {
  constructor(@Inject(CompanyService) private readonly company: CompanyService) {}

  @Get()
  async getSettings() {
    return this.company.getSettings();
  }

  @Put()
  async saveSettings(@Body() body: any) {
    return this.company.saveSettings(body);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async upload(@Body('kind') kind: string, @UploadedFile() file: any) {
    const image = await this.company.uploadImage(String(kind || ''), file);
    return { image };
  }
}

/**
 * Public read-only endpoint used by <img> tags for company logos and login
 * backdrops. Images are intentionally not protected by the admin guard.
 */
@Controller('company')
export class CompanyPublicController {
  constructor(@Inject(CompanyService) private readonly company: CompanyService) {}

  @Get('files/:id')
  async file(@Param('id') id: string, @Res() res: any) {
    const file = await this.company.getFile(id);
    res.setHeader('content-type', file.type);
    res.setHeader('content-disposition', 'inline; filename="' + file.name.replace(/[^a-zA-Z0-9._ -]/g, '_') + '"');
    res.setHeader('cache-control', 'public, max-age=86400');
    return res.send(file.data);
  }

  /** Public branding endpoint – returns active logo / backdrop IDs without auth. */
  @Get('branding')
  async branding() {
    return this.company.getPublicBranding();
  }
}
