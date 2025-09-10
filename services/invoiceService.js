const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class InvoiceService {
    constructor() {
        this.logoPath = path.join(__dirname, '../../store/assets/images/ripenred1.png');
    }

    async generateInvoice(orderData) {
        return new Promise((resolve, reject) => {
            try {
                if (!orderData || !orderData.orderId) throw new Error('Invalid order data: missing orderId');
                if (!orderData.orderItems) orderData.orderItems = [];
                if (!orderData.createdAt) orderData.createdAt = new Date();

                        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            info: {}
        });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                let currentY = 40;

                currentY = this.addHeader(doc, orderData, currentY);
                currentY = this.addCompanyAndCustomerInfo(doc, orderData, currentY + 5);
                currentY = this.addOrderDetails(doc, orderData, currentY + 10);
                currentY = this.addProductsTable(doc, orderData, currentY + 5);
                currentY = this.addTotals(doc, orderData, currentY + 10);
                this.addFooter(doc, currentY + 15);

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    addHeader(doc, orderData, y) {
                    try {
                if (fs.existsSync(this.logoPath)) {
                    doc.image(this.logoPath, 50, y, { width: 140 });
                }
            } catch (err) {
                console.error('Logo error:', err);
            }

            doc.fontSize(14).font('Helvetica-Bold').fillColor('#2E7D32')
                .text('INVOICE', 400, y);
            doc.fontSize(9).fillColor('#000')
                .text(`Invoice #: ${orderData.orderId}`, 400, y + 15)
                .text(`Date: ${new Date(orderData.createdAt).toLocaleDateString('en-IN')}`, 400, y + 28)
                .text(`Invoice Generated: ${new Date().toLocaleDateString('en-IN')}`, 400, y + 41);

            return y + 60;
    }

    addCompanyAndCustomerInfo(doc, orderData, y) {
        doc.fontSize(9).fillColor('#555')
            .text('From:', 50, y)
            .font('Helvetica-Bold').fillColor('#000')
            .text('Ripe\'n Red', 50, y + 10)
            .font('Helvetica').fillColor('#333')
            .text('Village Jabraloo', 50, y + 20)
            .text('Tehsil Rohru, Distt. Shimla, HP 171207', 50, y + 30)
            .text('Phone: +91 62399 04315', 50, y + 40)
            .text('Email: riipenred@gmail.com', 50, y + 50);

        doc.fontSize(9).fillColor('#555')
            .text('Bill To:', 300, y)
            .font('Helvetica-Bold').fillColor('#000')
            .text(orderData.isRegisteredUser ? (orderData.userName || 'Registered User') : (orderData.guestName || 'Guest User'), 300, y + 10)
            .font('Helvetica').fillColor('#333')
            .text(orderData.isRegisteredUser ? (orderData.userEmail || 'N/A') : (orderData.guestEmail || 'N/A'), 300, y + 20);

        if (orderData.shippingAddress) {
            const a = orderData.shippingAddress;
            doc.text(`${a.street || ''}`, 300, y + 30)
                .text(`${a.city || ''}, ${a.state || ''}`, 300, y + 40)
                .text(`${a.zipcode || ''}`, 300, y + 50);
        }

        return y + 65;
    }

    addOrderDetails(doc, orderData, y) {
        doc.moveTo(30, y).lineTo(550, y).strokeColor('#ccc').stroke();

        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
            .text('Order Details', 30, y + 6);

        doc.fontSize(10).font('Helvetica').fillColor('#333')
            .text(`Order Date: ${new Date(orderData.createdAt).toLocaleDateString('en-IN')}`, 30, y + 22)
            .text(`Payment Method: ${orderData.paymentMethod || 'Online Payment'}`, 30, y + 36)
           

        return y + 65;
    }

    addProductsTable(doc, orderData, y) {
        const startX = 50;
        const colWidths = [200, 60, 60, 60, 60]; // Added GST column
        const tableWidth = colWidths.reduce((a, b) => a + b, 0);

        // Table header
        doc.rect(startX, y, tableWidth, 18).fill('#2E7D32');
        doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold')
            .text('Item', startX + 5, y + 4)
            .text('Quantity', startX + colWidths[0] + 5, y + 4)
            .text('Price (₹)', startX + colWidths[0] + colWidths[1] + 5, y + 4)
            .text('GST (%)', startX + colWidths[0] + colWidths[1] + colWidths[2] + 5, y + 4)
            .text('Total (₹)', startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, y + 4);

        let currentY = y + 18;

        if (!Array.isArray(orderData.orderItems) || orderData.orderItems.length === 0) {
            doc.fillColor('#666').font('Helvetica').text('No items in this order', startX + 5, currentY + 4);
            return currentY + 18;
        }

        orderData.orderItems.forEach((item, idx) => {
            const rowHeight = 25;
            doc.fillColor(idx % 2 === 0 ? '#f9f9f9' : '#fff')
                .rect(startX, currentY, tableWidth, rowHeight).fill();

            doc.fillColor('#000').fontSize(8).font('Helvetica')
                .text(item.name || 'Product', startX + 5, currentY + 4, { width: colWidths[0] - 5 })
                .text(item.quantity || 1, startX + colWidths[0] + 5, currentY + 4)
                .text((item.price || 0).toFixed(2), startX + colWidths[0] + colWidths[1] + 5, currentY + 4)
                .text('0%', startX + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 4)
                .text(((item.price || 0) * (item.quantity || 1)).toFixed(2), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 4);

            currentY += rowHeight;
        });

        return currentY;
    }

    addTotals(doc, orderData, y) {
        // Add signature on the left side
        const signaturePath = path.join(__dirname, '../../store/assets/images/sign.png');
        if (fs.existsSync(signaturePath)) {
            try {
                doc.image(signaturePath, 50, y, { width: 120 });
                // Add text below signature
                doc.fontSize(8).font('Helvetica').fillColor('#666')
                    .text('digitally signed', 50, y + 125, { width: 120, align: 'center' });
            } catch (err) {
                console.error('Signature error:', err);
            }
        }

        // Adjust the rectangle height to accommodate discount line
        const hasDiscount = orderData.discountAmount && orderData.discountAmount > 0;
        const rectHeight = hasDiscount ? 82 : 70;
        doc.rect(330, y, 200, rectHeight).fill('#f4f4f4');
        
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(9)
            .text('Subtotal:', 340, y + 10);
        
        let currentY = y + 10;
        
        // Add discount line if discount exists
        if (hasDiscount) {
            doc.text('Discount:', 340, currentY + 12);
            currentY += 12;
        }
        
        doc.text('Shipping:', 340, currentY + 12)
            .text('Total:', 340, currentY + 38);

        doc.font('Helvetica').fillColor('#000')
            .text(`Rs.${(orderData.totalPrice || 0).toFixed(2)}`, 430, y + 10);
        
        currentY = y + 10;
        
        // Add discount amount if discount exists
        if (hasDiscount) {
            doc.font('Helvetica').fillColor('#d32f2f') // Red color for discount
                .text(`-Rs.${(orderData.discountAmount || 0).toFixed(2)}`, 430, currentY + 12);
            currentY += 12;
        }
        
        doc.font('Helvetica').fillColor('#000')
            .text(`Rs.${(orderData.shippingCharges || 0).toFixed(2)}`, 430, currentY + 12);

        doc.font('Helvetica-Bold').fillColor('#2E7D32').fontSize(11)
            .text(`Rs.${(orderData.totalPrice - (orderData.discountAmount || 0) + (orderData.shippingCharges || 0)).toFixed(2)}`, 430, currentY + 38);

        return y + (hasDiscount ? 92 : 80);
    }

    addFooter(doc, y) {
        doc.moveTo(50, y).lineTo(550, y).strokeColor('#ccc').stroke();
        doc.fontSize(7).fillColor('#666').font('Helvetica')
            .text('Thank you for choosing Ripe\'n Red!', 50, y + 8, { align: 'center', width: 500 })
            .text('For queries, contact riipenred@gmail.com', 50, y + 16, { align: 'center', width: 500 })
            .text('This is a computer-generated invoice.', 50, y + 24, { align: 'center', width: 500 });
    }

    generateFilename(orderId) {
        const date = new Date().toISOString().split('T')[0];
        return `RipeNRed-Invoice-${orderId}-${date}.pdf`;
    }

    async generateBulkInvoices(ordersData) {
        return new Promise((resolve, reject) => {
            try {
                if (!Array.isArray(ordersData) || ordersData.length === 0) {
                    throw new Error('Invalid orders data: empty or not an array');
                }

                const doc = new PDFDocument({
                    size: 'A4',
                    margin: 20, // Reduced margins for bulk printing
                    info: {}
                });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                let currentY = 20;
                let invoicesPerPage = 0;
                const maxInvoicesPerPage = 4;

                for (let i = 0; i < ordersData.length; i++) {
                    const orderData = ordersData[i];
                    
                    // Check if we need a new page
                    if (invoicesPerPage >= maxInvoicesPerPage) {
                        doc.addPage();
                        currentY = 20;
                        invoicesPerPage = 0;
                    }

                    // Calculate position for 2x2 grid layout using full page height
                    const invoiceIndex = invoicesPerPage;
                    let xOffset, yOffset;
                    
                    // A4 page height is approximately 842 points, use full height
                    const pageHeight = 842;
                    const topHalfY = 20;  // Start at top margin
                    const bottomHalfY = (pageHeight / 2) + 40;  // Start bottom half with more spacing
                    
                    if (invoiceIndex === 0) {
                        // Top left
                        xOffset = 15;
                        yOffset = topHalfY;
                    } else if (invoiceIndex === 1) {
                        // Top right
                        xOffset = 305;
                        yOffset = topHalfY;
                    } else if (invoiceIndex === 2) {
                        // Bottom left
                        xOffset = 15;
                        yOffset = bottomHalfY;
                    } else if (invoiceIndex === 3) {
                        // Bottom right
                        xOffset = 305;
                        yOffset = bottomHalfY;
                    }

                    // Generate invoice at calculated position with better spacing
                    this.addBulkInvoiceHeader(doc, orderData, yOffset, xOffset);
                    this.addBulkInvoiceDetails(doc, orderData, yOffset + 60, xOffset);
                    this.addBulkInvoiceProducts(doc, orderData, yOffset + 150, xOffset);
                    this.addBulkInvoiceTotals(doc, orderData, yOffset + 280, xOffset); // Increased spacing for longer product table
                    this.addBulkInvoiceFooter(doc, orderData, yOffset + 330, xOffset); // Adjusted footer position

                    invoicesPerPage++;
                    
                    // If we've placed 4 invoices, move to next page
                    if (invoicesPerPage === 4) {
                        doc.addPage();
                        invoicesPerPage = 0;
                    }
                }

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    addBulkInvoiceHeader(doc, orderData, y, xOffset = 15) {
        try {
            if (fs.existsSync(this.logoPath)) {
                doc.image(this.logoPath, xOffset, y, { width: 70 }); // Bigger logo
            }
        } catch (err) {
            console.error('Logo error:', err);
        }

        doc.fontSize(13).font('Helvetica-Bold').fillColor('#2E7D32')
            .text('INVOICE', xOffset + 120, y);
        doc.fontSize(10).fillColor('#000')
            .text(`Invoice #: ${orderData.orderId}`, xOffset + 120, y + 15)
            .text(`Order Date: ${new Date(orderData.createdAt).toLocaleDateString('en-IN')}`, xOffset + 120, y + 25)
            .text(`Invoice Generated: ${new Date().toLocaleDateString('en-IN')}`, xOffset + 120, y + 35);

        return y + 55;
    }

    addBulkInvoiceDetails(doc, orderData, y, xOffset = 15) {
        doc.fontSize(9).fillColor('#555')
            .text('From:', xOffset, y)
            .font('Helvetica-Bold').fillColor('#000')
            .text('Ripe\'n Red', xOffset, y + 15)
            .font('Helvetica').fillColor('#333')
            .text('Village Jabraloo', xOffset, y + 30)
            .text('Tehsil Rohru, Distt. Shimla', xOffset, y + 45)
            .text('HP 171207', xOffset, y + 60)
            .text('Email: riipenred@gmail.com', xOffset, y + 75);

        doc.fontSize(9).fillColor('#555')
            .text('Bill To:', xOffset + 120, y)
            .font('Helvetica-Bold').fillColor('#000')
            .text(orderData.isRegisteredUser ? (orderData.userName || 'Registered User') : (orderData.guestName || 'Guest User'), xOffset + 120, y + 15)
            .font('Helvetica').fillColor('#333')
            .text(orderData.isRegisteredUser ? (orderData.userEmail || 'N/A') : (orderData.guestEmail || 'N/A'), xOffset + 120, y + 30);

        if (orderData.shippingAddress) {
            const a = orderData.shippingAddress;
            doc.text(`${a.street || ''}`, xOffset + 120, y + 45)
                .text(`${a.city || ''}, ${a.state || ''}`, xOffset + 120, y + 60)
                .text(`${a.zipcode || ''}`, xOffset + 120, y + 75);
        }

        return y + 90;
    }

    addBulkInvoiceProducts(doc, orderData, y, xOffset = 15) {
        const startX = xOffset;
        const colWidths = [120, 30, 30, 30, 35]; // Expanded column widths for better readability
        const tableWidth = colWidths.reduce((a, b) => a + b, 0);

        // Table header
        doc.rect(startX, y, tableWidth, 20).fill('#2E7D32');
        doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
            .text('Item', startX + 3, y + 6)
            .text('Qty', startX + colWidths[0] + 3, y + 6)
            .text('Price', startX + colWidths[0] + colWidths[1] + 3, y + 6)
            .text('GST', startX + colWidths[0] + colWidths[1] + colWidths[2] + 3, y + 6)
            .text('Total', startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 3, y + 6);

        let currentY = y + 20;

        if (!Array.isArray(orderData.orderItems) || orderData.orderItems.length === 0) {
            doc.fillColor('#666').font('Helvetica').text('No items', startX + 3, currentY + 3);
            return currentY + 15;
        }

        // Show up to 6 items instead of just 3 for better product visibility
        const maxItemsToShow = 6;
        const itemsToShow = orderData.orderItems.slice(0, maxItemsToShow);
        
        // If there are many products, use a more compact format
        if (orderData.orderItems.length > 8) {
            // Compact format: show first 4 items, then summary
            const compactItems = orderData.orderItems.slice(0, 4);
            compactItems.forEach((item, idx) => {
                const rowHeight = 16; // More compact rows
                doc.fillColor(idx % 2 === 0 ? '#f9f9f9' : '#fff')
                    .rect(startX, currentY, tableWidth, rowHeight).fill();

                doc.fillColor('#000').fontSize(7).font('Helvetica') // Smaller font
                    .text(item.name || 'Product', startX + 3, currentY + 4, { width: colWidths[0] - 3 })
                    .text(item.quantity || 1, startX + colWidths[0] + 3, currentY + 4)
                    .text((item.price || 0).toFixed(2), startX + colWidths[0] + colWidths[1] + 3, currentY + 4)
                    .text('0%', startX + colWidths[0] + colWidths[1] + colWidths[2] + 3, currentY + 4)
                    .text(((item.price || 0) * (item.quantity || 1)).toFixed(2), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 3, currentY + 4);

                currentY += rowHeight;
            });
        } else {
            // Standard format: show up to 6 items
            itemsToShow.forEach((item, idx) => {
                const rowHeight = 20; // Slightly reduced row height to fit more items
                doc.fillColor(idx % 2 === 0 ? '#f9f9f9' : '#fff')
                    .rect(startX, currentY, tableWidth, rowHeight).fill();

                doc.fillColor('#000').fontSize(8).font('Helvetica')
                    .text(item.name || 'Product', startX + 3, currentY + 5, { width: colWidths[0] - 3 })
                    .text(item.quantity || 1, startX + colWidths[0] + 3, currentY + 5)
                    .text((item.price || 0).toFixed(2), startX + colWidths[0] + colWidths[1] + 3, currentY + 5)
                    .text('0%', startX + colWidths[0] + colWidths[1] + colWidths[2] + 3, currentY + 5)
                    .text(((item.price || 0) * (item.quantity || 1)).toFixed(2), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 3, currentY + 5);

                currentY += rowHeight + 1; // Reduced gap between rows to fit more items
            });
        }

        // Show summary row for remaining items
        if (orderData.orderItems.length > 6) {
            // Add a summary row showing total items and total value
            const remainingItems = orderData.orderItems.slice(orderData.orderItems.length > 8 ? 4 : 6);
            const remainingTotal = remainingItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
            
            doc.fillColor('#f0f0f0').rect(startX, currentY, tableWidth, 18).fill();
            doc.fillColor('#666').fontSize(8).font('Helvetica-Bold')
                .text(`+ ${remainingItems.length} more items`, startX + 3, currentY + 5)
                .text(`Total: Rs. ${remainingTotal.toFixed(2)}`, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 3, currentY + 5);
            
            currentY += 20;
        }

        return currentY;
    }

    addBulkInvoiceTotals(doc, orderData, y, xOffset = 15) {
        // Add signature on the left side
        const signaturePath = path.join(__dirname, '../../store/assets/images/sign.png');
        if (fs.existsSync(signaturePath)) {
            try {
                doc.image(signaturePath, xOffset, y+20, { width: 60 }); // Smaller signature for bulk invoices
                // Add text below signature
                doc.fontSize(7).font('Helvetica').fillColor('#666')
                    .text('digitally signed', xOffset, y + 65, { width: 60, align: 'center' });
            } catch (err) {
                console.error('Signature error:', err);
            }
        }

        // Adjust the rectangle height to accommodate discount line
        const hasDiscount = orderData.discountAmount && orderData.discountAmount > 0;
        const rectHeight = hasDiscount ? 52 : 40;
        doc.rect(xOffset + 120, y, 130, rectHeight).fill('#f4f4f4');
        
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(10)
            .text('Subtotal:', xOffset + 130, y + 6);
        
        let currentY = y + 6;
        
        // Add discount line if discount exists
        if (hasDiscount) {
            doc.text('Discount:', xOffset + 130, currentY + 12);
            currentY += 12;
        }
        
        doc.text('Shipping:', xOffset + 130, currentY + 12)
            .text('Total:', xOffset + 130, currentY + 24);

        doc.font('Helvetica').fillColor('#000').fontSize(9)
            .text(`Rs. ${(orderData.totalPrice || 0).toFixed(2)}`, xOffset + 190, y + 6);
        
        currentY = y + 6;
        
        // Add discount amount if discount exists
        if (hasDiscount) {
            doc.font('Helvetica').fillColor('#d32f2f').fontSize(9) // Red color for discount
                .text(`-Rs. ${(orderData.discountAmount || 0).toFixed(2)}`, xOffset + 190, currentY + 12);
            currentY += 12;
        }
        
        doc.font('Helvetica').fillColor('#000').fontSize(9)
            .text(`Rs. ${(orderData.shippingCharges || 0).toFixed(2)}`, xOffset + 190, currentY + 12);

        doc.font('Helvetica-Bold').fillColor('#2E7D32').fontSize(11)
            .text(`Rs. ${(orderData.totalPrice - (orderData.discountAmount || 0) + (orderData.shippingCharges || 0)).toFixed(2)}`, xOffset + 190, currentY + 24);

        return y + (hasDiscount ? 67 : 55);
    }

    addBulkInvoiceFooter(doc, orderData, y, xOffset = 15) {
        // Add a small separator line above footer
        doc.moveTo(xOffset, y).lineTo(xOffset + 245, y).strokeColor('#ccc').stroke();
        
        // Add footer text with smaller font size and compact spacing
        doc.fontSize(6).fillColor('#666').font('Helvetica')
            .text('Thank you for choosing Ripe\'n Red!', xOffset, y + 4, { align: 'center', width: 245 })
            .text('For queries, contact riipenred@gmail.com', xOffset, y + 10, { align: 'center', width: 245 })
            .text('Computer-generated invoice.', xOffset, y + 16, { align: 'center', width: 245 });
        
        return y + 25;
    }

    generateBulkFilename() {
        const date = new Date().toISOString().split('T')[0];
        return `RipeNRed-Bulk-Invoices-${date}.pdf`;
    }
}

module.exports = new InvoiceService();
